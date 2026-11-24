// الإشعارات بين التطبيقين + SQL التلقائي
import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PROVIDERS } from '../server/ai/router.js';
import { saveSettings, loadSettings, resetCache } from '../server/settings.js';
import { createProject, editApp, runSqlWithRepair, normalizeEvents } from '../server/generator.js';
import { getProject } from '../server/store.js';
import { assembleApp, notifierPath, isAllowedPath, ids } from '../server/stacks.js';
import { mergeRules, stripRuleComments } from '../server/integrations/firebase.js';
import { buildPreview } from '../shared/preview.js';

const notifyProject = (stack) => ({ name: 'Shop', slug: 'shop-abc123', stack, apps: [], notifications: { provider: 'firebase', events: [] } });
const app = { id: 'admin', name: 'Admin', files: {} };
const cfg = { type: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k', firebaseDbUrl: 'https://db.firebaseio.com' };

test('every stack gets a protected notifier + permissions/deps', () => {
  for (const stack of ['html', 'react', 'flutter', 'kotlin', 'python']) {
    const p = notifyProject(stack);
    const files = assembleApp(p, app, cfg);
    const np = notifierPath(stack, p, app);
    assert.ok(files[np], `${stack} notifier`);
    assert.equal(isAllowedPath(stack, np, p, app), false);
    const conf = Object.entries(files).find(([k]) => /(^|\/)config\.(js|dart|py)$|Config\.kt$/.test(k))[1];
    assert.match(conf, /shop-abc123/);
    assert.match(conf, /db\.firebaseio\.com/);
  }
  assert.match(assembleApp(notifyProject('html'), app, cfg)['package.json'], /@capacitor\/local-notifications/);
  assert.match(assembleApp(notifyProject('kotlin'), app, cfg)['app/src/main/AndroidManifest.xml'], /POST_NOTIFICATIONS/);
  assert.match(assembleApp(notifyProject('kotlin'), app, cfg)[notifierPath('kotlin', notifyProject('kotlin'), app)], new RegExp(`^package ${ids(notifyProject('kotlin'), app).pkg.replace(/\./g, '\\.')}$`, 'm'));
  const py = assembleApp(notifyProject('python'), app, cfg)['buildozer.spec'];
  assert.match(py, /,plyer/); assert.match(py, /POST_NOTIFICATIONS/);
  const pub = assembleApp(notifyProject('flutter'), { ...app, files: { 'pubspec.yaml': 'name: x\ndependencies:\n  flutter:\n    sdk: flutter\n' } }, cfg)['pubspec.yaml'];
  assert.match(pub, /^  flutter_local_notifications: \^17/m); assert.match(pub, /^  http:/m);
  // بدون إشعارات: لا مكتبة ولا صلاحيات
  const plain = assembleApp({ ...notifyProject('kotlin'), notifications: null }, app, cfg);
  assert.ok(!Object.keys(plain).some((k) => k.endsWith('Notifier.kt')));
  assert.ok(!plain['app/src/main/AndroidManifest.xml'].includes('POST_NOTIFICATIONS'));
});

test('native preview mock gets window.APKF injected', () => {
  const p = notifyProject('flutter');
  const files = { ...assembleApp(p, app, cfg), 'preview/index.html': '<html><head></head><body>mock</body></html>' };
  const html = buildPreview('flutter', files);
  assert.match(html, /window\.APKF = window\.Notifier = createNotifier/);
});

test('JS notifier: SSE put/patch → deliver once + delete; send posts to the other inbox', async () => {
  const calls = []; let es;
  const ctx = {
    window: {}, console, setTimeout, requestAnimationFrame: () => {}, JSON, Math, Date, Object, String, Promise,
    document: { body: null },
    fetch: async (url, opts = {}) => { calls.push([opts.method || 'GET', url, opts.body]); return { ok: true, json: async () => ({ name: 'x' }) }; },
    EventSource: class { constructor(u) { this.url = u; this.h = {}; es = this; } addEventListener(t, f) { this.h[t] = f; } },
  };
  ctx.window = ctx; ctx.window.parent = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('server/templates/notifier.js', 'utf8') + '\nwindow.N = createNotifier({appId:"admin",projectSlug:"s1",firebaseDbUrl:"https://db.firebaseio.com/"});', ctx);
  const got = [];
  ctx.N.onNotification((n) => got.push(n));
  ctx.N.start();
  assert.equal(es.url, 'https://db.firebaseio.com/notifications/s1/admin.json');
  es.h.put({ data: JSON.stringify({ path: '/', data: { k1: { title: 'طلب جديد', body: 'b', from: 'customer' } } }) });
  es.h.put({ data: JSON.stringify({ path: '/k2', data: { title: 'T2', from: 'customer' } }) });
  es.h.patch({ data: JSON.stringify({ path: '/', data: { k3: { title: 'T3', from: 'customer' } } }) });
  es.h.put({ data: JSON.stringify({ path: '/k1', data: { title: 'dup' } }) }); // مكرر
  es.h.put({ data: JSON.stringify({ path: '/k2', data: null }) }); // حذف
  assert.deepEqual(got.map((n) => n.title), ['طلب جديد', 'T2', 'T3']);
  assert.deepEqual(calls.filter((c) => c[0] === 'DELETE').map((c) => c[1].split('/').pop()), ['k1.json', 'k2.json', 'k3.json', 'k1.json'], 'duplicates are cleaned up too');
  await ctx.N.send('customer', 'جاهز', 'طلبك جاهز', { id: 5 });
  const post = calls.find((c) => c[0] === 'POST');
  assert.equal(post[1], 'https://db.firebaseio.com/notifications/s1/customer.json');
  const body = JSON.parse(post[2]);
  assert.equal(body.from, 'admin'); assert.deepEqual(body.ts, { '.sv': 'timestamp' }); assert.equal(body.data.id, 5);
});

test('firebase rules merge keeps existing rules and strips comments', () => {
  const cur = JSON.parse(stripRuleComments('{\n // comment\n "rules": { "other": {".read": true /* x */}, "url": "http://a//b" } }'));
  assert.equal(cur.rules.url, 'http://a//b');
  const m = mergeRules(cur, { notifications: true, projectSlug: 'p1', projectRules: { rules: { p1: { '.read': true } } } });
  assert.deepEqual(m.rules.other, { '.read': true });
  assert.ok(m.rules.notifications.$project.$app['.write']);
  assert.deepEqual(m.rules.p1, { '.read': true });
});

test('normalizeEvents maps plan ids and drops invalid/self/duplicates', () => {
  const apps = [{ id: 'customer' }, { id: 'admin' }];
  const ev = normalizeEvents([
    { from: 'Customer', to: 'Admin', event: 'New Order', title: 't' },
    { from: 'Customer', to: 'Admin', event: 'new order' },
    { from: 'admin', to: 'admin', event: 'x' },
    { from: 'ghost', to: 'admin', event: 'y' },
  ], apps, { Customer: 'customer', Admin: 'admin' });
  assert.deepEqual(ev.map((e) => `${e.from}>${e.to}:${e.event}`), ['customer>admin:new_order']);
});

test('runSqlWithRepair asks AI to fix failing SQL', async () => {
  resetCache();
  saveSettings({ gemini: { keys: ['AIzaFAKE', '', ''] } });
  const orig = PROVIDERS.gemini;
  PROVIDERS.gemini = async () => ({ text: '```sql\ncreate table if not exists ok_table(id int);\n```', model: 'f' });
  try {
    const seen = [];
    const runSql = async (_t, _r, q) => { seen.push(q); if (q.includes('bad')) throw new Error('syntax error near bad'); };
    const out = await runSqlWithRepair('create bad table', { token: 'sbp_x', ref: 'r' }, loadSettings(), () => {}, { runSql });
    assert.equal(out, 'create table if not exists ok_table(id int);');
    assert.equal(seen.length, 2);
  } finally { PROVIDERS.gemini = orig; }
});

test('linked project: Supabase SQL auto-applied (with repair) + Firebase rules + notifier in apps + edit migrations', async () => {
  resetCache();
  saveSettings({
    gemini: { keys: ['AIzaFAKE', '', ''] },
    supabase: { token: 'sbp_owner', ref: 'abcdefghijklmnopqrst' },
    firebase: { dbUrl: 'https://demo-rtdb.firebaseio.com', secret: 'fbsecret' },
  });
  const plan = '```json\n' + JSON.stringify({
    apps: [{ id: 'Customer', name: 'الزبون', role: 'c', description: 'd' }, { id: 'Restaurant', name: 'المطعم', role: 'r', description: 'd' }],
    sql: 'create tabel orders(id int);', contract: 'orders',
    notifications: [{ from: 'Customer', to: 'Restaurant', event: 'new_order', trigger: 'after insert', title: 'طلب جديد', body: '{item}' },
      { from: 'Restaurant', to: 'Customer', event: 'order_ready', trigger: 'status=ready', title: 'طلبك جاهز', body: '' }],
  }) + '\n```';
  const prompts = [];
  const orig = PROVIDERS.gemini;
  PROVIDERS.gemini = async ({ system, prompt }) => {
    prompts.push(system + '\n' + prompt);
    if (system.includes('architect')) return { text: plan, model: 'f' };
    if (system.includes('PostgreSQL / Supabase expert')) return { text: '```sql\ncreate table if not exists orders(id int);\n```', model: 'f' };
    if (prompt.includes('Requested change')) {
      return { text: '=== FILE: www/app.js ===\nNotifier.send("customer","x","y")\n=== END FILE ===\n=== SQL ===\nalter table orders add column if not exists rating int;\n=== END SQL ===\n=== NOTIFICATIONS ===\n[{"from":"restaurant","to":"customer","event":"order_rated","title":"شكراً"}]\n=== END NOTIFICATIONS ===', model: 'f' };
    }
    return { text: '=== FILE: www/index.html ===\n<html><body><script src="config.js"></script><script src="notify.js"></script></body></html>\n=== END FILE ===', model: 'f' };
  };
  const sqlRuns = []; let rulesPut = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (url.includes('api.supabase.com') && url.endsWith('/database/query')) {
      const q = JSON.parse(opts.body).query; sqlRuns.push(q);
      return q.includes('tabel') ? json({ message: 'syntax error at or near "tabel"' }, 400) : json([]);
    }
    if (url.includes('/api-keys')) return json([{ name: 'anon', api_key: 'anon-key' }]);
    if (url.includes('.settings/rules.json')) {
      if (opts.method === 'PUT') { rulesPut = JSON.parse(opts.body); return json({}); }
      return new Response('{ "rules": { "legacy": { ".read": false } } }');
    }
    return json({ message: 'unexpected ' + url }, 500);
  };
  try {
    const { projectId } = await createProject({ name: 'Resto', description: 'مطعم', stack: 'html', mode: 'linked', backendType: 'supabase' }, loadSettings(), () => {});
    const p = getProject(projectId);
    assert.ok(p.backend.applied, 'SQL applied automatically');
    assert.equal(sqlRuns.length, 2, 'failed once, repaired, re-run');
    assert.match(p.backend.sql, /create table if not exists orders/);
    assert.equal(p.backend.anonKey, 'anon-key');
    assert.ok(p.notifications.rulesApplied);
    assert.deepEqual(rulesPut.rules.legacy, { '.read': false }, 'existing rules preserved');
    assert.ok(rulesPut.rules.notifications);
    assert.deepEqual(p.notifications.events.map((e) => `${e.from}>${e.to}`), ['customer>restaurant', 'restaurant>customer']);
    // تعليمات التوليد تحتوي على API الإشعارات والأحداث الخاصة بكل تطبيق
    const genPrompt = prompts.find((x) => x.includes('This app: "المطعم"'));
    assert.match(genPrompt, /This app MUST SEND:[\s\S]*order_ready/);
    assert.match(genPrompt, /This app RECEIVES[\s\S]*new_order/);

    await editApp(p, 'restaurant', 'أضف تقييم', loadSettings(), () => {});
    const p2 = getProject(projectId);
    assert.ok(sqlRuns.at(-1).includes('add column if not exists rating'));
    assert.equal(p2.backend.migrations.length, 1);
    assert.match(p2.backend.sql, /rating int/);
    assert.ok(p2.notifications.events.some((e) => e.event === 'order_rated'));
  } finally { PROVIDERS.gemini = orig; globalThis.fetch = origFetch; }
});

test('notifications require a Firebase URL', async () => {
  resetCache();
  saveSettings({ gemini: { keys: ['AIzaFAKE', '', ''] }, firebase: { dbUrl: '' } });
  await assert.rejects(createProject({ description: 'x', stack: 'html', mode: 'linked' }, loadSettings(), () => {}), /Firebase/);
});
