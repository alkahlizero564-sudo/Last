import test from 'node:test';
import assert from 'node:assert/strict';
import { complete, buildAttempts } from '../server/ai/router.js';
import { defaults } from '../server/settings.js';

const settings = () => {
  const s = defaults({});
  s.gemini.keys = ['AIza1', 'AIza2', ''];
  s.groq.key = 'gsk_1';
  return s;
};

test('attempt order rotates Gemini keys then other providers', () => {
  assert.deepEqual(buildAttempts(settings()).map((a) => a.label), ['gemini#1', 'gemini#2', 'groq']);
  assert.deepEqual(buildAttempts(settings(), 'groq').map((a) => a.label), ['groq', 'gemini#1', 'gemini#2']);
});

test('falls back on failure', async () => {
  const calls = [];
  const providers = {
    gemini: async ({ key }) => { calls.push(key); throw new Error('429 quota'); },
    groq: async () => { calls.push('groq'); return { text: 'hello', model: 'm' }; },
  };
  const r = await complete(settings(), { system: 's', prompt: 'p', providers });
  assert.equal(r.text, 'hello');
  assert.equal(r.provider, 'groq');
  assert.deepEqual(calls, ['AIza1', 'AIza2', 'groq']);
});

test('errors when nothing configured', async () => {
  await assert.rejects(complete(defaults({}), { system: 's', prompt: 'p' }), /لا يوجد/);
});
