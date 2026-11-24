import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFiles, parseJson, safePath } from '../server/ai/parse.js';

test('parseFiles reads files, unfences, and deletions', () => {
  const t = `intro text
=== FILE: www/index.html ===
<h1>hi</h1>
=== END FILE ===
=== FILE: www/app.js ===
\`\`\`js
console.log(1)
\`\`\`
=== END FILE ===
=== DELETE: www/old.js ===`;
  const r = parseFiles(t);
  assert.deepEqual(Object.keys(r.files), ['www/index.html', 'www/app.js']);
  assert.equal(r.files['www/app.js'], 'console.log(1)');
  assert.deepEqual(r.deleted, ['www/old.js']);
});

test('safePath blocks traversal and absolute paths', () => {
  assert.equal(safePath('../etc/passwd'), null);
  assert.equal(safePath('/abs'), null);
  assert.equal(safePath('a//b'), null);
  assert.equal(safePath('./lib/main.dart'), 'lib/main.dart');
});

test('parseJson handles fenced and bare JSON', () => {
  assert.deepEqual(parseJson('here:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('blah {"b":[1,2]} end'), { b: [1, 2] });
  assert.throws(() => parseJson('nothing'));
});
