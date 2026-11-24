import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSettings, publicSettings, loadSettings, resetCache, validateSettings } from '../server/settings.js';

test('secrets are masked, masked values are preserved, cleared values are cleared', () => {
  resetCache();
  saveSettings({ github: { token: 'ghp_abcdefgh1234' }, gemini: { keys: ['AIzaKEY1xxxx', 'AIzaKEY2yyyy', ''] }, clients: [{ name: 'زبون', ref: 'abcdefghijklmnopqrst', token: 'sbp_secret9999' }] });
  const pub = publicSettings();
  assert.equal(pub.github.token, '••••1234');
  assert.equal(pub.clients[0].token, '••••9999');
  assert.ok(!JSON.stringify(pub).includes('ghp_abcdefgh'));
  // الواجهة ترسل القيم المقنّعة كما هي + تمسح المفتاح الثاني
  saveSettings({ github: { token: pub.github.token }, gemini: { keys: [pub.gemini.keys[0], '', ''] }, clients: pub.clients });
  const s = loadSettings();
  assert.equal(s.github.token, 'ghp_abcdefgh1234');
  assert.deepEqual(s.gemini.keys, ['AIzaKEY1xxxx', '', '']);
  assert.equal(s.clients[0].token, 'sbp_secret9999');
  // يعاد التحميل من الملف بشكل صحيح
  resetCache();
  assert.deepEqual(loadSettings().gemini.keys, ['AIzaKEY1xxxx', '', '']);
});

test('format warnings', () => {
  resetCache();
  saveSettings({ claude: { key: 'wrong' } });
  assert.ok(validateSettings().some((w) => w.includes('sk-ant-')));
  saveSettings({ claude: { key: '' } });
});
