// اختبار شامل بدون إنترنت: ذكاء اصطناعي وهمي ← إنشاء مشروع بتطبيقين ← تعديل ← ملفات المستودع ← دفع إلى GitHub وهمي
import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../server/ai/router.js';
import { saveSettings, loadSettings, resetCache } from '../server/settings.js';
import { createProject, editApp } from '../server/generator.js';
import { getProject } from '../server/store.js';
import { buildRepoFiles } from '../server/builder.js';
import { GitHub } from '../server/integrations/github.js';
import { buildPreview } from '../shared/preview.js';

const PLAN = '```json\n' + JSON.stringify({
  apps: [{ id: 'Customer', name: 'الزبون', role: 'customers', description: 'order food' }, { id: 'admin', name: 'المطعم', role: 'staff', description: 'manage orders' }],
  sql: '', firebaseRules: { rules: { '.read': true } }, contract: 'orders/{id}: {item, status}',
}) + '\n```';

function fakeAI({ prompt, system }) {
  if (system.includes('architect')) return { text: PLAN, model: 'fake' };
  if (prompt.includes('Requested change')) {
    return { text: '=== FILE: www/app.js ===\nconsole.log("edited")\n=== END FILE ===\n=== FILE: package.json ===\n{}\n=== END FILE ===', model: 'fake' };
  }
  return { text: `=== FILE: www/index.html ===
<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>App</h1><script src="config.js"></script><script src="app.js"></script></body></html>
=== END FILE ===
=== FILE: www/style.css ===
h1{color:teal}
=== END FILE ===
=== FILE: www/app.js ===
console.log(APP_CONFIG.backend)
=== END FILE ===
=== FILE: ../../evil.sh ===
rm -rf /
=== END FILE ===`, model: 'fake' };
}

test('full flow: plan → 2 linked apps → edit → repo files → github push', async () => {
  resetCache();
  saveSettings({ gemini: { keys: ['AIzaFAKE', '', ''] }, firebase: { dbUrl: 'https://demo-default-rtdb.firebaseio.com' } });
  const orig = PROVIDERS.gemini;
  PROVIDERS.gemini = async (o) => fakeAI(o);
  try {
    const logs = [];
    const { projectId } = await createProject({ name: 'Food Order', description: 'تطبيق طلبات', stack: 'html', mode: 'linked', backendType: 'firebase' }, loadSettings(), (m) => logs.push(m));
    const p = getProject(projectId);
    assert.equal(p.apps.length, 2);
    assert.deepEqual(p.apps.map((a) => a.id), ['customer', 'admin']);
    assert.ok(p.apps[0].files['www/index.html']);
    assert.ok(!Object.keys(p.apps[0].files).some((f) => f.includes('evil')), 'path traversal rejected');
    assert.ok(logs.some((l) => l.includes('⛔')));

    await editApp(p, 'admin', 'غيّر', loadSettings(), () => {});
    const p2 = getProject(projectId);
    assert.equal(p2.apps[1].files['www/app.js'], 'console.log("edited")');
    assert.ok(!('package.json' in p2.apps[1].files), 'scaffold files are protected');

    const files = await buildRepoFiles(p2, loadSettings());
    const dir = `projects/${p2.slug}`;
    assert.ok(files[`${dir}/customer/www/config.js`].includes('demo-default-rtdb'));
    assert.ok(files[`${dir}/admin/capacitor.config.json`]);
    assert.ok(files[`.github/workflows/build-${p2.slug}-admin.yml`]);
    assert.ok(!JSON.stringify(files).includes('AIzaFAKE'), 'AI keys never leak into the repo');

    const html = buildPreview('html', Object.fromEntries(Object.entries(files).filter(([k]) => k.startsWith(`${dir}/customer/`)).map(([k, v]) => [k.slice(dir.length + 10), v])));
    assert.match(html, /h1\{color:teal\}/);
    assert.match(html, /demo-default-rtdb/);

    // GitHub وهمي
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push(`${opts.method} ${url.replace('https://api.github.com', '')}`);
      const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'c0' } });
      if (url.includes('/git/commits/c0')) return json({ sha: 'c0', tree: { sha: 't0' } });
      if (url.endsWith('/git/blobs')) return json({ sha: 'b' + calls.length });
      if (url.endsWith('/git/trees')) { const body = JSON.parse(opts.body); assert.equal(body.base_tree, 't0'); assert.ok(body.tree.some((e) => e.sha === null && e.path === 'old/file')); return json({ sha: 't1' }); }
      if (url.endsWith('/git/commits')) return json({ sha: 'c1' });
      if (url.includes('/git/refs/heads/main')) return json({});
      if (url.endsWith('/dispatches')) return new Response(null, { status: 204 });
      return json({ message: 'nope' }, 404);
    };
    const gh = new GitHub('ghp_x', fakeFetch);
    const repo = { full_name: 'me/apk-app', default_branch: 'main' };
    const commit = await gh.commitFiles(repo, files, 'msg', ['old/file', `${dir}/customer/www/index.html`]);
    assert.equal(commit.sha, 'c1');
    await gh.dispatch(repo, `build-${p2.slug}-admin.yml`);
    assert.ok(calls.some((c) => c.includes('/dispatches')));
  } finally { PROVIDERS.gemini = orig; }
});
