// واجهة APK Forge (بدون إطار عمل — لا تحتاج بناء)
import { buildPreview } from '/shared/preview.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');

let PASSWORD = (() => { try { return sessionStorage.getItem('apkf-pass') || ''; } catch { return ''; } })();
let META = null;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(PASSWORD ? { 'x-admin-password': PASSWORD } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    PASSWORD = prompt('كلمة مرور لوحة التحكم:') || '';
    try { sessionStorage.setItem('apkf-pass', PASSWORD); } catch { /* */ }
    if (PASSWORD) return api(method, url, body);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 4000);
}

// تشغيل مهمة طويلة وعرض سجلها
function runJob(jobId, title) {
  return new Promise((resolve, reject) => {
    const m = $('#modal'); const logEl = $('#modal-log'); const close = $('#modal-close');
    $('#modal-title').textContent = title; logEl.textContent = '⏳ بدأ التنفيذ...'; close.disabled = true; m.classList.remove('hidden');
    close.onclick = () => m.classList.add('hidden');
    const tick = async () => {
      try {
        const j = await api('GET', `/api/jobs/${jobId}`);
        logEl.textContent = j.log.map((l) => l.msg).join('\n') || '⏳';
        logEl.scrollTop = logEl.scrollHeight;
        if (j.status === 'running') return setTimeout(tick, 1500);
        close.disabled = false;
        if (j.status === 'done') { setTimeout(() => m.classList.add('hidden'), 900); resolve(j.result); } else reject(new Error(j.error));
      } catch (e) { close.disabled = false; reject(e); }
    };
    tick();
  });
}

// ---------- التوجيه ----------
async function route() {
  const hash = location.hash || '#/';
  $$('nav a').forEach((a) => a.classList.toggle('active', hash === a.getAttribute('href')));
  if (!META) META = await api('GET', '/api/meta').catch(() => ({ stacks: {}, providers: [] }));
  try {
    if (hash === '#/') return await renderProjects();
    if (hash === '#/new') return await renderNew();
    if (hash === '#/settings') return await renderSettings();
    const m = hash.match(/^#\/p\/([a-z0-9-]+)/);
    if (m) return await renderProject(m[1]);
    view.innerHTML = '<p>الصفحة غير موجودة</p>';
  } catch (e) { view.innerHTML = `<div class="card"><b>خطأ:</b> ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

// ---------- قائمة المشاريع ----------
async function renderProjects() {
  const list = await api('GET', '/api/projects');
  view.innerHTML = `
    <div class="row"><h1>مشاريعي</h1><span class="spacer"></span><a class="btn primary" href="#/new">+ مشروع جديد</a></div>
    ${list.length ? '' : `<div class="card"><h3>ابدأ أول تطبيق 🚀</h3><p class="muted">صف تطبيقك بالعربي، اختر اللغة (HTML أو React أو Flutter أو Kotlin أو Python)، وسيبنيه الذكاء الاصطناعي مع معاينة فورية ثم ملف APK جاهز.</p>
      <p class="muted">لا تنسَ إضافة المفاتيح من <a href="#/settings">الإعدادات</a> أولاً.</p></div>`}
    <div class="grid">${list.map((p) => `
      <a class="card" href="#/p/${esc(p.id)}" style="color:inherit">
        <h3>${esc(p.name)}</h3>
        <div class="row"><span class="badge">${esc(META.stacks[p.stack]?.label || p.stack)}</span>
          <span class="badge">${p.mode === 'linked' ? 'تطبيقان مترابطان' : 'تطبيق واحد'}</span>
          ${p.backend && p.backend !== 'none' ? `<span class="badge">${esc(p.backend)}</span>` : ''}</div>
        <p class="muted">${p.apps.map(esc).join(' · ')}</p>
        <small class="muted">${new Date(p.updatedAt).toLocaleString('ar')}</small>
      </a>`).join('')}</div>`;
}

// ---------- مشروع جديد ----------
async function renderNew() {
  const { settings } = await api('GET', '/api/settings');
  const st = { stack: 'html', mode: 'single', backendType: 'none' };
  const stackDesc = {
    html: 'صفحات ويب خفيفة تُغلّف بـ Capacitor', react: 'واجهات تفاعلية حديثة + Capacitor', flutter: 'أداء أصلي وتصميم Material 3',
    kotlin: 'تطبيق أندرويد أصلي 100% بـ Compose', python: 'Kivy + Buildozer (بناء أبطأ)',
  };
  view.innerHTML = `
    <h1>مشروع جديد</h1>
    <div class="card">
      <label>اسم المشروع</label><input id="n-name" placeholder="مثال: مطعم الريّان">
      <label>صف التطبيق بالتفصيل (الشاشات، الميزات، الألوان، المستخدمون...)</label>
      <textarea id="n-desc" rows="6" placeholder="مثال: تطبيق طلبات لمطعم: الزبون يتصفح المنيو ويضيف للسلة ويرسل الطلب، وتطبيق ثانٍ للمطعم يستقبل الطلبات لحظياً ويغيّر حالتها..."></textarea>
    </div>
    <div class="card"><h3>اللغة / إطار العمل</h3><div class="choices" id="c-stack">
      ${Object.entries(META.stacks).map(([k, v]) => `<div class="choice" data-v="${k}"><b>${esc(v.label)}</b><small>${esc(stackDesc[k] || '')}</small></div>`).join('')}
    </div></div>
    <div class="card"><h3>عدد التطبيقات</h3><div class="choices" id="c-mode">
      <div class="choice" data-v="single"><b>تطبيق واحد</b><small>تطبيق مستقل</small></div>
      <div class="choice" data-v="linked"><b>تطبيقان مترابطان</b><small>مثل زبون + إدارة، متصلان لحظياً عبر قاعدة البيانات</small></div>
    </div></div>
    <div class="card"><h3>قاعدة البيانات</h3><div class="choices" id="c-backend">
      <div class="choice" data-v="none"><b>بدون</b><small>تخزين محلي فقط</small></div>
      <div class="choice" data-v="supabase"><b>Supabase</b><small>PostgreSQL + Realtime، إنشاء الجداول تلقائياً</small></div>
      <div class="choice" data-v="firebase"><b>Firebase</b><small>Realtime Database</small></div>
    </div>
      <div id="target-box" class="hidden">
        <label>حساب Supabase المستخدم</label>
        <select id="n-target"><option value="own">حسابي (${esc(settings.supabase.ref || 'غير مضبوط')})</option>
          ${settings.clients.map((c) => `<option value="${esc(c.ref)}">زبون: ${esc(c.name)} (${esc(c.ref)})</option>`).join('')}</select>
        <label class="row" style="color:inherit"><input type="checkbox" id="n-apply" checked style="width:auto"> تطبيق SQL على القاعدة تلقائياً بعد التخطيط</label>
      </div>
    </div>
    <div class="card"><h3>الذكاء الاصطناعي</h3>
      <select id="n-ai"><option value="">تلقائي (حسب الترتيب في الإعدادات مع التبديل عند الفشل)</option>
        ${META.providers.map((p) => `<option value="${p}">ابدأ بـ ${p}</option>`).join('')}</select>
    </div>
    <button class="btn primary" id="n-go" style="font-size:17px;padding:12px 26px">✨ ابنِ التطبيق</button>`;

  const bind = (id, key, after) => {
    const box = $(id);
    const paint = () => $$('.choice', box).forEach((c) => c.classList.toggle('on', c.dataset.v === st[key]));
    box.onclick = (e) => { const c = e.target.closest('.choice'); if (!c) return; st[key] = c.dataset.v; paint(); after?.(); };
    paint();
  };
  bind('#c-stack', 'stack'); bind('#c-mode', 'mode');
  bind('#c-backend', 'backendType', () => $('#target-box').classList.toggle('hidden', st.backendType !== 'supabase'));

  $('#n-go').onclick = async () => {
    try {
      const body = {
        name: $('#n-name').value.trim(), description: $('#n-desc').value.trim(), ...st,
        target: $('#n-target').value, autoApplySql: $('#n-apply').checked, preferred: $('#n-ai').value || undefined,
      };
      if (!body.description) return toast('اكتب وصف التطبيق', true);
      const { jobId } = await api('POST', '/api/projects', body);
      const r = await runJob(jobId, '🔨 بناء المشروع بالذكاء الاصطناعي');
      location.hash = `#/p/${r.projectId}`;
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- صفحة المشروع ----------
async function renderProject(id) {
  const data = await api('GET', `/api/projects/${id}`);
  const p = data.project;
  const state = { app: p.apps[0]?.id, file: null, panel: 'chat' };
  const appOf = () => p.apps.find((a) => a.id === state.app);
  const allFiles = () => ({ ...data.generated[state.app], ...appOf().files });
  const entryFor = () => {
    const f = Object.keys(appOf().files);
    return ['www/index.html', 'src/App.jsx', 'lib/main.dart', 'main.py'].find((x) => f.includes(x)) || f.find((x) => x.endsWith('MainActivity.kt')) || f[0];
  };
  state.file = entryFor();

  view.innerHTML = `
    <div class="row">
      <h1 style="margin:0">${esc(p.name)}</h1>
      <span class="badge">${esc(META.stacks[p.stack]?.label)}</span>
      ${p.backend.type !== 'none' ? `<span class="badge">${esc(p.backend.type)}${p.backend.type === 'supabase' ? (p.backend.applied ? ' ✓ الجداول جاهزة' : ' — SQL لم يُطبَّق') : ''}</span>` : ''}
      <span class="spacer"></span>
      <button class="btn primary" id="b-build">📦 ابنِ APK</button>
      <button class="btn danger sm" id="b-del">حذف</button>
    </div>
    ${data.backendConfigError ? `<div class="warn" style="margin-top:12px">⚠️ ${esc(data.backendConfigError)}</div>` : ''}
    <div class="tabs" style="margin-top:14px" id="app-tabs"></div>
    <div class="workspace">
      <div class="card"><b>الملفات</b><ul class="files" id="files"></ul>
        <button class="btn sm" id="b-newfile" style="margin-top:8px">+ ملف</button></div>
      <div>
        <div class="row" style="margin-bottom:8px"><code id="cur-file"></code><span class="spacer"></span><span id="save-state" class="muted"></span></div>
        <textarea class="code" id="editor" spellcheck="false"></textarea>
      </div>
      <div class="preview-col">
        <div class="row" style="margin-bottom:8px"><b>👁️ معاينة فورية</b><span class="spacer"></span>
          <button class="btn sm" id="b-refresh">↻ تحديث</button><button class="btn sm" id="b-open">فتح بنافذة</button></div>
        <div class="phone"><iframe id="preview" sandbox="allow-scripts allow-forms allow-modals allow-popups"></iframe></div>
        ${META.stacks[p.stack]?.web ? '' : '<p class="hint">المعاينة نسخة ويب مطابقة يولدها الذكاء الاصطناعي؛ التطبيق الحقيقي يُبنى بـ ' + esc(META.stacks[p.stack]?.label) + '.</p>'}
      </div>
    </div>
    <div class="tabs" id="panel-tabs" style="margin-top:16px">
      <button class="tab" data-p="chat">🤖 المساعد</button><button class="tab" data-p="backend">🗄️ قاعدة البيانات</button>
      <button class="tab" data-p="build">📦 البناء والتسليم</button><button class="tab" data-p="info">ℹ️ الوصف</button>
    </div>
    <div class="card" id="panel"></div>`;

  const iframe = $('#preview');
  const refreshPreview = () => { iframe.srcdoc = buildPreview(p.stack, allFiles()); };

  const paintTabs = () => {
    $('#app-tabs').innerHTML = p.apps.map((a) => `<button class="tab ${a.id === state.app ? 'on' : ''}" data-a="${esc(a.id)}">📱 ${esc(a.name)} <small>(${esc(a.role || a.id)})</small></button>`).join('');
  };
  const paintFiles = () => {
    const own = Object.keys(appOf().files).sort();
    const gen = Object.keys(data.generated[state.app] || {}).sort();
    $('#files').innerHTML = own.map((f) => `<li class="${f === state.file ? 'on' : ''}" data-f="${esc(f)}">${esc(f)}</li>`).join('')
      + `<li class="sec">ملفات يولدها النظام (للقراءة)</li>`
      + gen.map((f) => `<li class="gen ${f === state.file ? 'on' : ''}" data-f="${esc(f)}">🔒 ${esc(f)}</li>`).join('');
  };
  const openFile = () => {
    const own = state.file in appOf().files;
    $('#cur-file').textContent = state.file || '';
    const ed = $('#editor');
    ed.value = allFiles()[state.file] ?? '';
    ed.readOnly = !own;
    $('#save-state').textContent = own ? '' : 'للقراءة فقط';
  };
  const paintAll = () => { paintTabs(); paintFiles(); openFile(); refreshPreview(); };

  $('#app-tabs').onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; state.app = b.dataset.a; state.file = entryFor(); paintAll(); };
  $('#files').onclick = (e) => { const li = e.target.closest('[data-f]'); if (!li) return; state.file = li.dataset.f; paintFiles(); openFile(); };

  // تحرير مباشر: المعاينة تتحدث أثناء الكتابة، والحفظ تلقائي
  let tPrev, tSave;
  $('#editor').addEventListener('input', (e) => {
    if (e.target.readOnly) return;
    appOf().files[state.file] = e.target.value;
    $('#save-state').textContent = '● غير محفوظ';
    clearTimeout(tPrev); tPrev = setTimeout(refreshPreview, 350);
    clearTimeout(tSave); tSave = setTimeout(async () => {
      try { await api('PUT', `/api/projects/${p.id}/apps/${state.app}/files`, { path: state.file, content: appOf().files[state.file] }); $('#save-state').textContent = '✓ محفوظ'; } catch (err) { $('#save-state').textContent = '⚠️ ' + err.message; }
    }, 1000);
  });
  $('#editor').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const s = t.selectionStart; t.setRangeText('  ', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); }
  });
  $('#b-refresh').onclick = refreshPreview;
  $('#b-open').onclick = () => { const w = window.open('', '_blank'); if (w) { w.document.open(); w.document.write(buildPreview(p.stack, allFiles())); w.document.close(); } };
  $('#b-newfile').onclick = async () => {
    const path = prompt('مسار الملف الجديد (مثال: www/about.html أو lib/screens/home.dart):'); if (!path) return;
    try { await api('PUT', `/api/projects/${p.id}/apps/${state.app}/files`, { path, content: '' }); appOf().files[path] = ''; state.file = path; paintFiles(); openFile(); } catch (e) { toast(e.message, true); }
  };
  $('#b-del').onclick = async () => { if (!confirm('حذف المشروع نهائياً من هذه اللوحة؟')) return; await api('DELETE', `/api/projects/${p.id}`); location.hash = '#/'; };
  $('#b-build').onclick = () => { state.panel = 'build'; paintPanel(); startBuild(); };

  async function reload() { const fresh = await api('GET', `/api/projects/${p.id}`); Object.assign(p, fresh.project); data.generated = fresh.generated; paintAll(); paintPanel(); }

  // ---------- اللوحات السفلية ----------
  const panel = $('#panel');
  $('#panel-tabs').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; state.panel = b.dataset.p; paintPanel(); };

  function paintPanel() {
    $$('#panel-tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.p === state.panel));
    if (state.panel === 'chat') {
      const hist = p.history.filter((h) => h.type === 'edit' && h.app === state.app).slice(-8);
      panel.innerHTML = `<h3>اطلب أي تعديل على "${esc(appOf().name)}"</h3>
        <div class="chat">${hist.map((h) => `<div class="msg">🗨️ ${esc(h.text)} <small class="muted">— ${(h.files || []).length} ملف</small></div>`).join('') || '<p class="muted">مثال: "أضف شاشة تسجيل دخول"، "غيّر اللون الأساسي للأخضر"، "أضف إشعار عند وصول طلب جديد"</p>'}</div>
        <textarea id="ai-msg" rows="3" placeholder="اكتب التعديل المطلوب..."></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="ai-go">✨ نفّذ التعديل</button>
          <button class="btn sm" id="ai-regen">↺ إعادة توليد التطبيق كاملاً</button></div>`;
      $('#ai-go').onclick = async () => {
        const instruction = $('#ai-msg').value.trim(); if (!instruction) return;
        try { const { jobId } = await api('POST', `/api/projects/${p.id}/apps/${state.app}/edit`, { instruction }); await runJob(jobId, '✏️ تعديل التطبيق'); await reload(); } catch (e) { toast(e.message, true); }
      };
      $('#ai-regen').onclick = async () => {
        if (!confirm('سيتم حذف ملفات هذا التطبيق وتوليده من جديد. متأكد؟')) return;
        try { const { jobId } = await api('POST', `/api/projects/${p.id}/apps/${state.app}/regenerate`, {}); await runJob(jobId, '↺ إعادة التوليد'); state.file = null; await reload(); state.file = entryFor(); openFile(); } catch (e) { toast(e.message, true); }
      };
    } else if (state.panel === 'backend') {
      const b = p.backend;
      if (b.type === 'none') { panel.innerHTML = '<p class="muted">هذا المشروع بدون قاعدة بيانات سحابية.</p>'; return; }
      panel.innerHTML = `
        ${b.type === 'supabase' ? `<h3>SQL — الجداول والصلاحيات ${b.applied ? '<span class="badge ok">مطبّق</span>' : '<span class="badge run">غير مطبّق</span>'}</h3>
          <p class="hint">الحساب: ${b.target === 'own' || !b.target ? 'حسابي' : 'زبون ' + esc(b.target)}. راجع الكود ثم اضغط تطبيق. مفتاح الوصول sbp_ يبقى على الخادم فقط؛ التطبيقات تحصل على المفتاح العام (anon) فقط.</p>
          <textarea id="sql" class="ltr code" style="min-height:260px">${esc(b.sql)}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn" id="sql-save">💾 حفظ</button><button class="btn primary" id="sql-apply">▶️ تطبيق على Supabase</button></div>`
        : `<h3>قواعد أمان Firebase المقترحة</h3><p class="hint">انسخها إلى Firebase Console ← Realtime Database ← Rules.</p>
          <textarea class="ltr code" readonly style="min-height:200px">${esc(JSON.stringify(b.firebaseRules || {}, null, 2))}</textarea>`}
        <h3 style="margin-top:16px">عقد البيانات بين التطبيقات</h3>
        <textarea id="contract" rows="6">${esc(b.contract)}</textarea>
        <button class="btn sm" id="contract-save" style="margin-top:6px">💾 حفظ العقد</button>`;
      $('#contract-save').onclick = async () => { await api('PUT', `/api/projects/${p.id}/backend`, { contract: $('#contract').value }); p.backend.contract = $('#contract').value; toast('تم الحفظ'); };
      if (b.type === 'supabase') {
        $('#sql-save').onclick = async () => { await api('PUT', `/api/projects/${p.id}/backend`, { sql: $('#sql').value }); p.backend.sql = $('#sql').value; p.backend.applied = false; toast('تم الحفظ'); paintPanel(); };
        $('#sql-apply').onclick = async () => {
          try { await api('PUT', `/api/projects/${p.id}/backend`, { sql: $('#sql').value }); const { jobId } = await api('POST', `/api/projects/${p.id}/backend/apply`); await runJob(jobId, '🗄️ تطبيق SQL'); await reload(); } catch (e) { toast(e.message, true); }
        };
      }
    } else if (state.panel === 'build') {
      panel.innerHTML = `<div class="row"><h3 style="margin:0">البناء عبر GitHub Actions</h3><span class="spacer"></span>
          <button class="btn primary" id="bp-build">📦 دفع وبناء الكل</button><button class="btn" id="bp-refresh">↻ تحديث الحالة</button></div>
        <p class="hint">يُدفع المشروع إلى مستودعك على GitHub (مجلد projects/${esc(p.slug)}) ويبني كل تطبيق في سير عمل منفصل، ثم يُنشر الـ APK في Releases.</p>
        ${p.github?.url ? `<p>المستودع: <a href="${esc(p.github.url)}" target="_blank" rel="noopener">${esc(p.github.repo)}</a></p>` : ''}
        <div id="bp-status" class="muted">${p.github?.repo ? '...جاري التحميل' : 'لم يُبنَ بعد.'}</div>
        <h3 style="margin-top:18px">✉️ إرسال التطبيق للزبون</h3>
        <div class="row"><input id="bp-to" class="ltr" placeholder="client@email.com" style="max-width:320px"><input id="bp-msg" placeholder="رسالة اختيارية" style="max-width:380px">
          <button class="btn" id="bp-send">إرسال</button></div>`;
      $('#bp-build').onclick = startBuild;
      $('#bp-refresh').onclick = loadStatus;
      $('#bp-send').onclick = async () => {
        try { const { jobId } = await api('POST', `/api/projects/${p.id}/notify`, { to: $('#bp-to').value.trim(), message: $('#bp-msg').value.trim() }); await runJob(jobId, '✉️ إرسال للزبون'); toast('تم الإرسال ✅'); } catch (e) { toast(e.message, true); }
      };
      if (p.github?.repo) loadStatus();
    } else {
      panel.innerHTML = `<h3>وصف المشروع</h3><p style="white-space:pre-wrap">${esc(p.description)}</p>
        ${p.apps.map((a) => `<h3>📱 ${esc(a.name)} <small class="muted">(${esc(a.role)})</small></h3><p style="white-space:pre-wrap" class="muted">${esc(a.description)}</p>`).join('')}`;
    }
  }

  async function startBuild() {
    try {
      const { jobId } = await api('POST', `/api/projects/${p.id}/build`, {});
      const r = await runJob(jobId, '📦 دفع المشروع وبدء البناء');
      p.github = { ...(p.github || {}), url: r.repo, repo: r.repo.replace('https://github.com/', '') };
      paintPanel();
      pollStatus(25);
    } catch (e) { toast(e.message, true); }
  }

  const statusBadge = (r) => r.status !== 'completed' ? `<span class="badge run">⏳ ${esc(r.status)}</span>` : r.conclusion === 'success' ? '<span class="badge ok">✓ نجح</span>' : `<span class="badge err">✗ ${esc(r.conclusion)}</span>`;
  async function loadStatus() {
    const box = $('#bp-status'); if (!box) return null;
    try {
      const s = await api('GET', `/api/projects/${p.id}/builds`);
      box.innerHTML = `<table><tr><th>التطبيق</th><th>رقم البناء</th><th>الحالة</th><th>APK</th><th></th></tr>
        ${s.apps.map((a) => (a.runs.length ? a.runs : [null]).map((r, i) => `<tr><td>${i ? '' : esc(a.name)}</td>
          ${r ? `<td>#${r.number}</td><td>${statusBadge(r)}</td>
          <td>${r.apk ? `<a class="btn sm primary" href="/api/projects/${p.id}/apk/${r.apk.assetId}" data-dl>⬇️ تنزيل (${(r.apk.size / 1048576).toFixed(1)}MB)</a>` : ''}</td>
          <td><a href="${esc(r.url)}" target="_blank" rel="noopener">السجل</a></td>` : '<td colspan="4" class="muted">لا يوجد بناء بعد</td>'}</tr>`).join('')).join('')}</table>`;
      // التنزيل يحتاج كلمة المرور في الترويسة
      $$('[data-dl]', box).forEach((a) => a.onclick = async (e) => {
        if (!PASSWORD) return;
        e.preventDefault();
        const res = await fetch(a.href, { headers: { 'x-admin-password': PASSWORD } });
        const url = URL.createObjectURL(await res.blob());
        Object.assign(document.createElement('a'), { href: url, download: `${p.slug}.apk` }).click();
      });
      return s;
    } catch (e) { box.textContent = '⚠️ ' + e.message; return null; }
  }
  async function pollStatus(n) {
    if (n <= 0 || state.panel !== 'build' || !document.body.contains(panel)) return;
    const s = await loadStatus();
    const running = s?.apps.some((a) => !a.runs.length || a.runs[0].status !== 'completed' || (a.runs[0].conclusion === 'success' && !a.runs[0].apk));
    if (running) setTimeout(() => pollStatus(n - 1), 20000);
  }

  paintAll(); paintPanel();
}

// ---------- الإعدادات ----------
async function renderSettings() {
  const { settings: s, warnings } = await api('GET', '/api/settings');
  const f = (id, label, val, ph = '', hint = '') => `<label for="${id}">${label}</label><input id="${id}" class="ltr" value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off">${hint ? `<div class="hint">${hint}</div>` : ''}`;
  const test = (what, label = 'اختبار الاتصال') => `<button class="btn sm" data-test="${what}" style="margin-top:10px">${label}</button> <span class="hint" data-res="${what}"></span>`;
  view.innerHTML = `
    <h1>الإعدادات والمفاتيح</h1>
    <p class="muted">المفاتيح تُحفظ على هذا الخادم فقط (data/settings.json) ولا تُرفع إلى GitHub ولا تُضمَّن في التطبيقات. تُعرض مقنّعة — اتركها كما هي للإبقاء على القيمة الحالية.</p>
    ${warnings.length ? `<div class="warn">${warnings.map(esc).join('<br>')}</div>` : ''}
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(420px,1fr))">
      <fieldset><legend>🗄️ Supabase (حسابي)</legend>
        ${f('supabase.token', 'مفتاح Supabase (Access Token)', s.supabase.token, 'sbp_...')}
        ${f('supabase.ref', 'Supabase project ref', s.supabase.ref, 'abcdefghijklmnopqrst', '20 حرفاً — من رابط المشروع')}
        ${test('supabase')}</fieldset>
      <fieldset><legend>🔥 Firebase</legend>
        ${f('firebase.dbUrl', 'رابط Realtime Database', s.firebase.dbUrl, 'https://xxxx-default-rtdb.firebaseio.com')}
        ${f('firebase.apiKey', 'Web API Key (اختياري)', s.firebase.apiKey, 'AIza...')}
        ${test('firebase')}</fieldset>
      <fieldset><legend>🐙 GitHub</legend>
        ${f('github.token', 'مفتاح GitHub (Token)', s.github.token, 'ghp_... / github_pat_...', 'الصلاحيات المطلوبة: repo + workflow')}
        ${f('github.repo', 'اسم المستودع', s.github.repo, 'apk-app')}
        <label class="row" style="color:inherit"><input type="checkbox" id="github.private" ${s.github.private !== false ? 'checked' : ''} style="width:auto"> مستودع خاص (Private)</label>
        ${test('github')}</fieldset>
      <fieldset><legend>✨ Gemini</legend>
        ${f('gemini.keys.0', 'مفتاح Gemini API', s.gemini.keys[0], 'AIza...')}
        ${f('gemini.keys.1', 'مفتاح Gemini إضافي 2 (اختياري)', s.gemini.keys[1], 'AIza...', 'من مشروع آخر — يُستخدم تلقائياً عند نفاد حصة الأول')}
        ${f('gemini.keys.2', 'مفتاح Gemini إضافي 3 (اختياري)', s.gemini.keys[2], 'AIza...')}
        ${f('gemini.model', 'اسم النموذج', s.gemini.model, 'فارغ = gemini-2.5-flash')}</fieldset>
      <fieldset><legend>🧠 Claude</legend>
        ${f('claude.key', 'مفتاح Claude API', s.claude.key, 'sk-ant-...')}
        ${f('claude.model', 'اسم النموذج', s.claude.model, 'فارغ = claude-opus-5-5')}</fieldset>
      <fieldset><legend>🔀 OpenRouter / ⚡ Groq</legend>
        ${f('openrouter.key', 'مفتاح OpenRouter', s.openrouter.key, 'sk-or-...')}
        ${f('openrouter.model', 'نموذج OpenRouter', s.openrouter.model, 'openai/gpt-oss-120b:free')}
        ${f('groq.key', 'مفتاح Groq', s.groq.key, 'gsk_...')}
        ${f('groq.model', 'نموذج Groq (اختياري)', s.groq.model, 'openai/gpt-oss-120b')}</fieldset>
      <fieldset><legend>🤖 ترتيب الذكاء الاصطناعي</legend>
        ${f('ai.order', 'الترتيب (يُجرَّب التالي تلقائياً عند الفشل)', s.ai.order.join(','), 'gemini,claude,openrouter,groq')}
        ${test('ai', 'اختبار كل المفاتيح')}</fieldset>
      <fieldset><legend>✉️ البريد</legend>
        <label>المزوّد</label><select id="mail.provider"><option value="gmail" ${s.mail.provider === 'gmail' ? 'selected' : ''}>Gmail</option><option value="brevo" ${s.mail.provider === 'brevo' ? 'selected' : ''}>Brevo</option></select>
        ${f('gmail.user', 'إيميل Gmail', s.gmail.user, 'you@gmail.com')}
        ${f('gmail.appPassword', 'كلمة سر التطبيقات (16 حرف)', s.gmail.appPassword, 'xxxx xxxx xxxx xxxx')}
        ${f('brevo.login', 'Brevo Login (من صفحة SMTP)', s.brevo.login, 'xxxx@smtp-brevo.com')}
        ${f('brevo.sender', 'إيميل المُرسِل (متحقق منه في Brevo)', s.brevo.sender, 'you@gmail.com')}
        ${f('brevo.key', 'مفتاح SMTP', s.brevo.key, 'xsmtpsib-...')}
        <label>إرسال رسالة تجريبية إلى (اختياري)</label><input id="mail-test-to" class="ltr" placeholder="you@example.com">
        ${test('mail')}</fieldset>
    </div>
    <fieldset><legend>👥 مشاريع الزبائن (Supabase)</legend>
      <table id="clients"><tr><th>اسم المشروع (اسم الزبون)</th><th>رمز المشروع (Project Ref)</th><th>مفتاح الوصول من حساب الزبون</th><th></th></tr></table>
      <button class="btn sm" id="add-client" style="margin-top:8px">+ إضافة زبون</button></fieldset>
    <button class="btn primary" id="save" style="font-size:17px;padding:12px 30px">💾 حفظ الإعدادات</button>`;

  const clients = s.clients.map((c) => ({ ...c }));
  const paintClients = () => {
    $('#clients').innerHTML = '<tr><th>اسم المشروع (اسم الزبون)</th><th>رمز المشروع (Project Ref)</th><th>مفتاح الوصول من حساب الزبون</th><th></th></tr>'
      + clients.map((c, i) => `<tr><td><input data-c="${i}" data-k="name" value="${esc(c.name)}"></td>
        <td><input class="ltr" data-c="${i}" data-k="ref" value="${esc(c.ref)}" placeholder="20 حرفاً"></td>
        <td><input class="ltr" data-c="${i}" data-k="token" value="${esc(c.token)}" placeholder="sbp_..."></td>
        <td><button class="btn sm" data-ctest="${i}">اختبار</button> <button class="btn sm danger" data-cdel="${i}">✕</button></td></tr>`).join('');
  };
  paintClients();
  $('#clients').oninput = (e) => { const t = e.target; if (t.dataset.c) clients[t.dataset.c][t.dataset.k] = t.value; };
  $('#clients').onclick = async (e) => {
    const del = e.target.dataset.cdel; const tst = e.target.dataset.ctest;
    if (del !== undefined) { clients.splice(del, 1); paintClients(); }
    if (tst !== undefined) {
      try { await save(true); const r = await api('POST', '/api/settings/test/client', { ref: clients[tst].ref }); toast(r.message); } catch (err) { toast(err.message, true); }
    }
  };
  $('#add-client').onclick = () => { clients.push({ name: '', ref: '', token: '' }); paintClients(); };

  const collect = () => {
    const out = { supabase: {}, firebase: {}, github: {}, gemini: { keys: ['', '', ''] }, claude: {}, openrouter: {}, groq: {}, ai: {}, mail: {}, gmail: {}, brevo: {} };
    $$('input[id*="."], select[id*="."]').forEach((el) => {
      const [a, b, c] = el.id.split('.');
      const v = el.type === 'checkbox' ? el.checked : el.value.trim();
      if (c !== undefined) out[a][b][Number(c)] = v; else out[a][b] = v;
    });
    out.ai.order = String(out.ai.order).split(',').map((x) => x.trim()).filter(Boolean);
    out.clients = clients;
    return out;
  };
  async function save(silent) {
    const r = await api('PUT', '/api/settings', collect());
    if (!silent) { toast('تم الحفظ ✅'); if (r.warnings.length) toast(r.warnings.join(' — '), true); renderSettings(); }
  }
  $('#save').onclick = () => save().catch((e) => toast(e.message, true));
  $$('[data-test]').forEach((b) => b.onclick = async () => {
    const what = b.dataset.test; const out = $(`[data-res="${what}"]`);
    out.textContent = '⏳...';
    try {
      await save(true);
      const r = await api('POST', `/api/settings/test/${what}`, what === 'mail' ? { to: $('#mail-test-to').value.trim() } : {});
      out.textContent = r.results ? r.results.map((x) => `${x.ok ? '✅' : '❌'} ${x.label}${x.ok ? ` (${x.model})` : `: ${x.error}`}`).join(' | ') : `${r.ok ? '✅' : '❌'} ${r.message}`;
    } catch (e) { out.textContent = '❌ ' + e.message; }
  });
}

route();
