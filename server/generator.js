// محرك توليد المشاريع: خطة ← قاعدة البيانات (SQL تلقائي) ← الإشعارات (Firebase) ← توليد كل تطبيق ← تعديلات لاحقة.
import { complete } from './ai/router.js';
import { planPrompt, generatePrompt, editPrompt, sqlRepairPrompt } from './ai/prompts.js';
import { parseFiles, parseJson, parseSql } from './ai/parse.js';
import { STACKS, isAllowedPath, ids, hasNotify } from './stacks.js';
import { newId, slugify, saveProject } from './store.js';
import * as supa from './integrations/supabase.js';
import { applyRules } from './integrations/firebase.js';

// يحدد بيانات الربط الفعلية لمشروع (حسابك أو حساب زبون)
export function backendTarget(project, settings) {
  const b = project.backend || {};
  if (b.type === 'supabase') {
    const client = b.target && b.target !== 'own' ? settings.clients.find((c) => c.ref === b.target) : null;
    if (b.target && b.target !== 'own' && !client) throw new Error(`مشروع الزبون ${b.target} غير موجود في الإعدادات`);
    const ref = client ? client.ref : settings.supabase.ref;
    const token = client ? client.token : settings.supabase.token;
    if (!ref || !token) throw new Error('بيانات Supabase غير مكتملة (project ref + access token)');
    return { type: 'supabase', ref, token, label: client ? `الزبون: ${client.name}` : 'حسابي' };
  }
  if (b.type === 'firebase') {
    if (!settings.firebase.dbUrl) throw new Error('رابط Firebase Realtime Database غير مضبوط');
    return { type: 'firebase' };
  }
  return { type: 'none' };
}

function firebasePublic(settings) {
  return { firebaseDbUrl: settings.firebase.dbUrl.replace(/\/$/, ''), firebaseApiKey: settings.firebase.apiKey || '' };
}

// القيم العامة التي تُضمّن داخل التطبيق
export async function publicBackendConfig(project, settings, { fetchKey = true } = {}) {
  const b = project.backend || {};
  // الإشعارات عبر Firebase تعمل بجانب أي قاعدة بيانات
  const notify = hasNotify(project) && settings.firebase.dbUrl ? firebasePublic(settings) : {};
  if (b.type === 'supabase') {
    const t = backendTarget(project, settings);
    if (!b.anonKey && fetchKey) b.anonKey = await supa.getAnonKey(t.token, t.ref);
    return { type: 'supabase', supabaseUrl: supa.supabaseUrl(t.ref), supabaseAnonKey: b.anonKey || '', ...notify };
  }
  if (b.type === 'firebase') return { type: 'firebase', ...firebasePublic(settings) };
  return { type: 'none', ...notify };
}

function cleanAppId(id, used) {
  let s = String(id || 'app').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'app';
  if (!/^[a-z]/.test(s)) s = 'a' + s;
  let out = s; let n = 2;
  while (used.has(out)) out = s + n++;
  used.add(out);
  return out;
}

function applyFiles(project, app, parsed, log) {
  let accepted = 0;
  for (const p of parsed.rejected || []) log(`⛔ تم رفض مسار غير آمن: ${p}`);
  for (const [p, content] of Object.entries(parsed.files)) {
    if (isAllowedPath(project.stack, p, project, app)) { app.files[p] = content; accepted++; } else log(`⛔ تم تجاهل ملف خارج المسموح: ${p}`);
  }
  for (const p of parsed.deleted) if (p in app.files) { delete app.files[p]; log(`🗑️ حذف ${p}`); }
  return accepted;
}

function checkEntry(project, app) {
  const need = {
    html: ['www/index.html'], react: ['index.html', 'src/main.jsx'], flutter: ['lib/main.dart'],
    kotlin: [`app/src/main/java/${ids(project, app).pkg.replace(/\./g, '/')}/MainActivity.kt`], python: ['main.py'],
  }[project.stack];
  return need.filter((p) => !(p in app.files));
}

// يوحّد أحداث الإشعارات ويحوّل معرّفات التطبيقات حسب الخريطة (معرّف الخطة ← المعرّف النهائي)
export function normalizeEvents(events, apps, idMap = {}) {
  const valid = new Set(apps.map((a) => a.id));
  const fix = (x) => {
    const raw = String(x || '');
    return idMap[raw] || idMap[raw.toLowerCase()] || raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  };
  const seen = new Set();
  return (Array.isArray(events) ? events : []).map((e) => ({
    from: fix(e.from), to: fix(e.to),
    event: String(e.event || 'event').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40),
    trigger: String(e.trigger || ''), title: String(e.title || ''), body: String(e.body || ''),
    ...(e.data && typeof e.data === 'object' ? { data: e.data } : {}),
  })).filter((e) => valid.has(e.from) && valid.has(e.to) && e.from !== e.to && !seen.has(`${e.from}>${e.to}:${e.event}`) && seen.add(`${e.from}>${e.to}:${e.event}`));
}

export async function generateApp(project, app, settings, log, preferred) {
  log(`🛠️ توليد تطبيق "${app.name}"...`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { system, prompt } = generatePrompt(project, app);
    const r = await complete(settings, { system, prompt, preferred, log });
    const parsed = parseFiles(r.text);
    const n = applyFiles(project, app, parsed, log);
    const missing = checkEntry(project, app);
    log(`📄 ${n} ملف لـ "${app.name}" (${r.provider})`);
    if (!missing.length) return app;
    log(`⚠️ ملفات أساسية ناقصة: ${missing.join(', ')} — إعادة المحاولة (${attempt}/2)`);
  }
  throw new Error(`لم يكتمل توليد "${app.name}" — الملفات الأساسية ناقصة`);
}

export async function createProject(input, settings, log) {
  const { name, description, stack, mode = 'single', backendType = 'none', target = 'own', preferred, autoApplySql = true } = input;
  if (!STACKS[stack]) throw new Error('اختر لغة صحيحة');
  if (!description?.trim()) throw new Error('اكتب وصف التطبيق');
  // الإشعارات بين التطبيقين: افتراضياً مفعّلة للتطبيقين المترابطين
  const notifications = mode === 'linked' && (input.notifications ?? true);
  if (notifications && !settings.firebase.dbUrl) {
    throw new Error('الإشعارات بين التطبيقين تحتاج رابط Firebase Realtime Database في الإعدادات (أو ألغِ خيار الإشعارات)');
  }

  const project = {
    id: newId(name || 'app'), name: name || 'تطبيقي', slug: '', description, stack, mode,
    backend: { type: backendType, target, sql: '', firebaseRules: null, contract: '', applied: false, migrations: [] },
    notifications: notifications ? { provider: 'firebase', events: [], rulesApplied: false } : null,
    apps: [], history: [], github: { pushedPaths: [] }, builds: [], createdAt: new Date().toISOString(),
  };
  project.slug = project.id; // فريد ويصلح كمجلد في المستودع ومسار في Firebase
  if (backendType !== 'none') backendTarget(project, settings); // تحقق مبكر من الإعدادات

  log('🧭 تخطيط المشروع وتصميم قاعدة البيانات...');
  const pp = planPrompt({ description, stack, mode, backendType, notifications, slug: project.slug });
  const planRes = await complete(settings, { ...pp, preferred, log });
  const plan = parseJson(planRes.text);
  const used = new Set();
  const idMap = {};
  const wanted = mode === 'linked' ? 2 : 1;
  project.apps = (plan.apps || []).slice(0, wanted).map((a) => {
    const id = cleanAppId(a.id, used);
    idMap[String(a.id)] = id; idMap[String(a.id).toLowerCase()] = id;
    return { id, name: a.name || 'App', role: a.role || '', description: a.description || description, files: {} };
  });
  if (project.apps.length < wanted) throw new Error('لم تُرجع الخطة عدد التطبيقات المطلوب');
  project.backend.sql = backendType === 'supabase' ? String(plan.sql || '') : '';
  project.backend.firebaseRules = backendType === 'firebase' ? plan.firebaseRules || null : null;
  project.backend.contract = String(plan.contract || '');
  log(`📋 الخطة: ${project.apps.map((a) => `${a.name} (${a.id})`).join(' + ')}`);
  if (notifications) {
    project.notifications.events = normalizeEvents(plan.notifications, project.apps, idMap);
    log(`🔔 ${project.notifications.events.length} حدث إشعار: ${project.notifications.events.map((e) => `${e.from}→${e.to}:${e.event}`).join('، ') || '—'}`);
  }
  saveProject(project);

  // قاعدة البيانات: تطبيق SQL تلقائياً (مع إصلاح ذاتي عند الخطأ) قبل توليد الكود
  if (backendType === 'supabase' && autoApplySql && project.backend.sql.trim()) {
    try { await applyBackend(project, settings, log, { repair: true, preferred }); } catch (e) {
      log(`⚠️ لم يكتمل تطبيق SQL تلقائياً: ${e.message} — راجعه من تبويب قاعدة البيانات`);
    }
  }
  // Firebase: قواعد الإشعارات (وبيانات المشروع إن كانت Firebase)
  if (notifications || backendType === 'firebase') {
    try { await applyFirebaseRules(project, settings, log); } catch (e) { log(`⚠️ قواعد Firebase: ${e.message}`); }
  }

  for (const app of project.apps) {
    await generateApp(project, app, settings, log, preferred);
    saveProject(project);
  }
  project.history.push({ at: new Date().toISOString(), type: 'create', text: description });
  saveProject(project);
  log('🎉 اكتمل التوليد — افتح المعاينة');
  return { projectId: project.id };
}

// ينفّذ SQL على Supabase؛ عند الفشل يطلب من الذكاء الاصطناعي إصلاحه ويعيد المحاولة (حتى مرتين)
export async function runSqlWithRepair(sql, t, settings, log, { repair = true, preferred, runSql = supa.runSql } = {}) {
  let current = sql;
  for (let attempt = 0; ; attempt++) {
    try {
      await runSql(t.token, t.ref, current);
      return current;
    } catch (e) {
      if (!repair || attempt >= 2) throw e;
      log(`🩹 خطأ SQL: ${e.message.slice(0, 200)} — إصلاح تلقائي (${attempt + 1}/2)...`);
      const r = await complete(settings, { ...sqlRepairPrompt(current, e.message), preferred, log });
      current = parseSql(r.text);
    }
  }
}

export async function applyBackend(project, settings, log, opts = {}) {
  const t = backendTarget(project, settings);
  if (t.type !== 'supabase') throw new Error('تطبيق SQL متاح لمشاريع Supabase فقط');
  log(`🗄️ تنفيذ SQL على Supabase (${t.label})...`);
  project.backend.sql = await runSqlWithRepair(project.backend.sql, t, settings, log, opts);
  project.backend.applied = true;
  project.backend.anonKey = await supa.getAnonKey(t.token, t.ref);
  saveProject(project);
  log('✅ تم إنشاء الجداول والصلاحيات و Realtime');
}

export async function applyFirebaseRules(project, settings, log) {
  const { dbUrl, secret } = settings.firebase;
  if (!dbUrl) throw new Error('رابط Firebase غير مضبوط');
  if (!secret) {
    log('ℹ️ لم يُضبط Database secret لـ Firebase — انسخ القواعد المقترحة من تبويب قاعدة البيانات إلى Firebase Console');
    return false;
  }
  log('🔥 تطبيق قواعد Firebase (دمج مع القواعد الحالية)...');
  await applyRules(dbUrl, secret, {
    notifications: hasNotify(project),
    projectSlug: project.backend.type === 'firebase' ? project.slug : null,
    projectRules: project.backend.type === 'firebase' ? project.backend.firebaseRules : null,
  });
  if (project.notifications) project.notifications.rulesApplied = true;
  project.backend.firebaseRulesApplied = true;
  saveProject(project);
  log('✅ قواعد Firebase مطبّقة');
  return true;
}

export async function editApp(project, appId, instruction, settings, log, preferred) {
  const app = project.apps.find((a) => a.id === appId);
  if (!app) throw new Error('التطبيق غير موجود');
  log(`✏️ تعديل "${app.name}": ${instruction.slice(0, 120)}`);
  const { system, prompt } = editPrompt(project, app, instruction);
  const r = await complete(settings, { system, prompt, preferred, log });
  const parsed = parseFiles(r.text);
  const n = applyFiles(project, app, parsed, log);
  if (!n && !parsed.deleted.length && !parsed.sql) throw new Error('لم يُرجع الذكاء الاصطناعي أي تعديل بالصيغة المطلوبة');

  // تعديلات قاعدة البيانات تُطبَّق تلقائياً وتُضاف لسجل SQL المشروع
  if (parsed.sql && project.backend?.type === 'supabase') {
    const t = backendTarget(project, settings);
    log('🗄️ تطبيق تعديلات قاعدة البيانات تلقائياً...');
    const applied = await runSqlWithRepair(parsed.sql, t, settings, log, { preferred });
    project.backend.migrations = [...(project.backend.migrations || []), { at: new Date().toISOString(), sql: applied }];
    project.backend.sql = `${project.backend.sql.trim()}\n\n-- ${new Date().toISOString()}: ${instruction.slice(0, 80).replace(/\n/g, ' ')}\n${applied}\n`;
    log('✅ تم تحديث قاعدة البيانات');
  }
  // أحداث إشعارات جديدة تُضاف للعقد المشترك بين التطبيقين
  if (parsed.notifications.length && hasNotify(project)) {
    const merged = normalizeEvents([...project.notifications.events, ...parsed.notifications], project.apps);
    const added = merged.length - project.notifications.events.length;
    project.notifications.events = merged;
    if (added > 0) log(`🔔 أُضيف ${added} حدث إشعار — حدّث التطبيق الآخر ليستقبله`);
  }

  project.history.push({ at: new Date().toISOString(), type: 'edit', app: appId, text: instruction, files: Object.keys(parsed.files), sql: !!parsed.sql });
  saveProject(project);
  log(`✅ تم تعديل ${n} ملف`);
  return { changed: Object.keys(parsed.files), deleted: parsed.deleted };
}

export { slugify };
