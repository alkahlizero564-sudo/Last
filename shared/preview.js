// محرك المعاينة الفورية — يعمل في المتصفح (وفي Node للاختبارات).
// HTML: تضمين ملفات CSS/JS المحلية داخل صفحة واحدة.
// React: تحويل JSX داخل المتصفح بـ Babel وتحميل الوحدات كـ blob + esm.sh.
// Flutter / Kotlin / Python: نسخة ويب مطابقة يولدها الذكاء الاصطناعي (preview/index.html).

const ERROR_OVERLAY = `<script>
(function(){
  function show(msg){
    var d=document.getElementById('__err')||document.createElement('pre');
    d.id='__err';
    d.style.cssText='position:fixed;left:0;right:0;bottom:0;max-height:45%;overflow:auto;margin:0;padding:10px;background:#2b0b0e;color:#ffb4b4;font:12px/1.4 monospace;z-index:2147483647;white-space:pre-wrap;direction:ltr';
    d.textContent=(d.textContent?d.textContent+'\\n':'')+msg;
    (document.body||document.documentElement).appendChild(d);
  }
  window.addEventListener('error',function(e){show('⚠ '+(e.message||e)+(e.filename?' ('+e.filename.split('/').pop()+':'+e.lineno+')':''));});
  window.addEventListener('unhandledrejection',function(e){show('⚠ '+(e.reason&&e.reason.message||e.reason));});
  window.__showError=show;
})();
</script>`;

function injectHead(html, snippet) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + snippet);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + snippet + '</head>');
  return snippet + html;
}

function resolveRel(baseDir, ref) {
  if (/^(https?:|data:|blob:|\/\/|#)/i.test(ref)) return null;
  const parts = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const seg of ref.split('?')[0].split('#')[0].split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

const escScript = (s) => s.replace(/<\/script/gi, '<\\/script');
const escStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

export function htmlPreview(files, entry = 'www/index.html') {
  let html = files[entry];
  if (html == null) return placeholder('لا يوجد ملف ' + entry);
  const baseDir = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
  // <link rel="stylesheet" href="x.css">
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    const p = href && resolveRel(baseDir, href);
    return p && files[p] != null ? `<style data-src="${p}">\n${escStyle(files[p])}\n</style>` : tag;
  });
  // <script src="x.js"></script>
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => {
    const p = resolveRel(baseDir, src);
    if (!p || files[p] == null) return tag;
    const attrs = (a + b).replace(/\s+/g, ' ').trim();
    return `<script ${attrs} data-src="${p}">\n${escScript(files[p])}\n</script>`;
  });
  return injectHead(html, ERROR_OVERLAY);
}

const IMPORT_MAP = {
  react: 'https://esm.sh/react@18.3.1',
  'react/jsx-runtime': 'https://esm.sh/react@18.3.1/jsx-runtime',
  'react-dom': 'https://esm.sh/react-dom@18.3.1?external=react',
  'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client?external=react',
  '@supabase/supabase-js': 'https://esm.sh/@supabase/supabase-js@2.45.4',
};

export function reactPreview(files) {
  const srcFiles = {};
  for (const [p, c] of Object.entries(files)) if (p.startsWith('src/')) srcFiles[p] = c;
  if (!srcFiles['src/main.jsx'] && !srcFiles['src/main.js']) return placeholder('لا يوجد src/main.jsx');
  const entry = srcFiles['src/main.jsx'] != null ? 'src/main.jsx' : 'src/main.js';
  // نأخذ index.html كقالب لكن نزيل سكربت main لأننا نحمّله بأنفسنا
  let shell = files['index.html'] || '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>';
  shell = shell.replace(/<script\b[^>]*type\s*=\s*["']module["'][^>]*>[\s\S]*?<\/script>/gi, '');
  const loader = `<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"></script>
<script type="importmap">${JSON.stringify({ imports: IMPORT_MAP })}</script>
<script>
(function(){
  var FILES = ${escScript(JSON.stringify(srcFiles))};
  var MAP = ${JSON.stringify(IMPORT_MAP)};
  var urls = {};
  function resolve(from, spec){
    var parts = from.split('/'); parts.pop();
    spec.split('/').forEach(function(s){ if(s==='..') parts.pop(); else if(s && s!=='.') parts.push(s); });
    var p = parts.join('/');
    var c = [p, p+'.jsx', p+'.js', p+'/index.jsx', p+'/index.js'];
    for (var i=0;i<c.length;i++) if (FILES[c[i]] != null) return c[i];
    throw new Error('Cannot resolve "'+spec+'" from '+from);
  }
  function css(path){
    var s=document.createElement('style'); s.setAttribute('data-src',path); s.textContent=FILES[path]; document.head.appendChild(s);
  }
  function load(path){
    if (urls[path]) return urls[path];
    urls[path] = 'data:text/javascript,'; // حماية من الدوران
    var out = Babel.transform(FILES[path], { presets: [['react', { runtime: 'automatic' }]], filename: path, sourceType: 'module' }).code;
    out = out.replace(/(\\bimport\\s*(?:[\\w*{}\\s,$]+\\s*from\\s*)?|\\bexport\\s*(?:\\*|\\{[^}]*\\})\\s*from\\s*|\\bimport\\s*\\(\\s*)(['"])([^'"]+)\\2/g, function(m, pre, q, spec){
      if (spec.charAt(0)==='.') {
        var r = resolve(path, spec);
        if (/\\.css$/.test(r)) { css(r); return pre+q+'data:text/javascript,'+q; }
        if (/\\.(png|jpe?g|svg|gif|webp)$/.test(r)) return pre+q+'data:text/javascript,export default ""'+q;
        return pre+q+load(r)+q;
      }
      if (MAP[spec]) return m;
      if (/\\.css$/.test(spec)) return pre+q+'data:text/javascript,'+q;
      return pre+q+'https://esm.sh/'+spec+q;
    });
    var url = URL.createObjectURL(new Blob([out + '\\n//# sourceURL=' + path], { type: 'text/javascript' }));
    urls[path] = url;
    return url;
  }
  window.addEventListener('DOMContentLoaded', function(){
    try { import(load(${JSON.stringify(entry)})).catch(function(e){ window.__showError(e.message); }); }
    catch(e){ window.__showError(e.message); }
  });
})();
</script>`;
  return injectHead(shell, ERROR_OVERLAY + loader);
}

export function placeholder(msg) {
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;display:grid;place-items:center;height:100vh;font-family:Tahoma,Arial;background:#f4f5fb;color:#555;text-align:center;padding:20px;box-sizing:border-box">
<div><div style="font-size:42px">📱</div><p>${String(msg).replace(/[<>&]/g, '')}</p></div></body></html>`;
}

export function buildPreview(stack, files) {
  if (stack === 'html') return htmlPreview(files, 'www/index.html');
  if (stack === 'react') return reactPreview(files);
  const mock = files['preview/index.html'];
  return mock ? injectHead(mock, ERROR_OVERLAY) : placeholder('لا توجد معاينة ويب لهذا التطبيق بعد. اطلب من المساعد: "أنشئ معاينة preview/index.html"');
}
