import test from 'node:test';
import assert from 'node:assert/strict';
import { STACKS, ids, workflow, assembleApp, isAllowedPath, configFile, configPath, normalizePubspec } from '../server/stacks.js';

const project = (stack) => ({ name: 'متجر', slug: 'shop-a1b2c3', stack, apps: [] });
const app = { id: 'admin', name: 'لوحة "الإدارة"', files: {} };
const cfg = { type: 'supabase', supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon$key"' };

test('ids are valid Android/Dart identifiers', () => {
  const i = ids(project('flutter'), { id: '9x', name: 'a' });
  assert.match(i.pkg, /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
  assert.match(i.dartName, /^[a-z][a-z0-9_]*$/);
});

for (const stack of Object.keys(STACKS)) {
  test(`${stack}: workflow + assemble + config`, () => {
    const p = project(stack);
    const wf = workflow(p, app);
    assert.match(wf, /workflow_dispatch/);
    assert.match(wf, /working-directory: projects\/shop-a1b2c3\/admin/);
    assert.match(wf, /softprops\/action-gh-release@v2/);
    assert.ok(!/\t/.test(wf), 'YAML must not contain tabs');
    const files = assembleApp(p, app, cfg);
    assert.ok(files[configPath(stack, p, app)].includes('x.supabase.co'));
    // لا يجوز للذكاء الاصطناعي الكتابة فوق ملف الإعدادات
    assert.equal(isAllowedPath(stack, configPath(stack, p, app), p, app), false);
    assert.equal(isAllowedPath(stack, '.github/workflows/x.yml', p, app), false);
  });
}

test('Dart/Kotlin config escapes $ and quotes', () => {
  const d = configFile('flutter', project('flutter'), app, cfg);
  assert.ok(d.includes('anon\\$key\\"'));
  const k = configFile('kotlin', project('kotlin'), app, cfg);
  assert.ok(k.includes('const val SUPABASE_ANON_KEY = "anon\\$key\\""'));
});

test('allowed paths per stack', () => {
  assert.ok(isAllowedPath('html', 'www/app.js', project('html'), app));
  assert.ok(!isAllowedPath('html', 'package.json', project('html'), app));
  assert.ok(isAllowedPath('react', 'src/App.jsx', project('react'), app));
  assert.ok(!isAllowedPath('react', 'vite.config.js', project('react'), app));
  assert.ok(isAllowedPath('flutter', 'preview/index.html', project('flutter'), app));
  assert.ok(!isAllowedPath('html', 'preview/index.html', project('html'), app));
  assert.ok(isAllowedPath('python', 'main.py', project('python'), app));
  assert.ok(!isAllowedPath('python', 'buildozer.spec', project('python'), app));
});

test('display name is sanitized for manifests/sed', () => {
  assert.ok(!ids(project('kotlin'), app).displayName.includes('"'));
});

test('normalizePubspec forces the package name', () => {
  assert.match(normalizePubspec('name: wrong\nversion: 1.0.0', 'good_name'), /^name: good_name$/m);
  assert.match(normalizePubspec('', 'x_y'), /^name: x_y$/m);
});
