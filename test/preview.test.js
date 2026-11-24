import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview } from '../shared/preview.js';

test('html preview inlines local css/js and keeps CDN scripts', () => {
  const html = buildPreview('html', {
    'www/index.html': '<html><head><link rel="stylesheet" href="style.css"><script src="https://cdn.x/y.js"></script></head><body><script src="config.js"></script><script src="./js/app.js"></script></body></html>',
    'www/style.css': 'body{color:red}',
    'www/config.js': 'window.APP_CONFIG={}',
    'www/js/app.js': 'console.log("</script>")',
  });
  assert.match(html, /body\{color:red\}/);
  assert.match(html, /window\.APP_CONFIG/);
  assert.match(html, /src="https:\/\/cdn\.x\/y\.js"/);
  assert.ok(html.includes('<\\/script>'), 'closing script tags inside code are escaped');
  assert.match(html, /__showError/);
});

test('react preview embeds sources and import map', () => {
  const html = buildPreview('react', { 'index.html': '<html><head></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>', 'src/main.jsx': 'import App from "./App"', 'src/App.jsx': 'export default () => <b/>' });
  assert.match(html, /importmap/);
  assert.match(html, /src\/App\.jsx/);
  assert.ok(!html.includes('src="/src/main.jsx"'));
});

test('native stacks use AI mock or a placeholder', () => {
  assert.match(buildPreview('flutter', { 'preview/index.html': '<html><head></head><body>mock</body></html>' }), /mock/);
  assert.match(buildPreview('kotlin', {}), /preview\/index\.html/);
});
