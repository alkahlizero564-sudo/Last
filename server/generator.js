// محرك توليد المشاريع: خطة ← توليد كل تطبيق ← ربط قاعدة البيانات ← تعديلات لاحقة.
import { complete } from './ai/router.js';
import { planPrompt, generatePrompt, editPrompt } from './ai/prompts.js';
import { parseFiles, parseJson } from './ai/parse.js';
import { STACKS, isAllowedPath, ids } from './stacks.js';
import { newId, slugify, saveProject } from './store.js';
import * as supa from './integrations/supabase.js';

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

// القيم العامة التي تُضمّن داخل التطبيق
export async function publicBackendConfig(project, settings, { fetchKey = true } = {}) {
  const b = project.backend || {};
  if (b.type === 'supabase') {
    const t = backendTarget(project, settings);
    if (!b.anonKey && fetchKey) b.anonKey = await supa.getAnonKey(t.token, t.ref);
    return { type: 'supabase', supabaseUrl: supa.supabaseUrl(t.ref), supabaseAnonKey: b.anonKey || '' };
  }
  if (b.type === 'firebase') {
    return { type: 'firebase', firebaseDbUrl: settings.firebase.dbUrl.replace(/\/$/, ''), firebaseApiKey: settings.firebase.apiKey || '' };
  }
  return { type: 'none' };
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

  const project = {
    id: newId(name || 'app'), name: name || 'تطبيقي', slug: '', description, stack, mode,
    backend: { type: backendType, target, sql: '', firebaseRules: null, contract: '', applied: false },
    apps: [], history: [], github: { pushedPaths: [] }, builds: [], createdAt: new Date().toISOString(),
  };
  project.slug = project.id; // فريد ويصلح كمجلد في المستودع
  if (backendType !== 'none') backendTarget(project, settings); // تحقق مبكر من الإعدادات

  log('🧭 تخطيط المشروع وتصميم قاعدة البيانات...');
  const pp = planPrompt({ description, stack, mode, backendType });
  const planRes = await complete(settings, { ...pp, preferred, log });
  const plan = parseJson(planRes.text);
  const used = new Set();
  const wanted = mode === 'linked' ? 2 : 1;
  project.apps = (plan.apps || []).slice(0, wanted).map((a) => ({
    id: cleanAppId(a.id, used), name: a.name || 'App', role: a.role || '', description: a.description || description, files: {},
  }));
  if (project.apps.length < wanted) throw new Error('لم تُرجع الخطة عدد التطبيقات المطلوب');
  project.backend.sql = backendType === 'supabase' ? String(plan.sql || '') : '';
  project.backend.firebaseRules = backendType === 'firebase' ? plan.firebaseRules || null : null;
  project.backend.contract = String(plan.contract || '');
  log(`📋 الخطة: ${project.apps.map((a) => `${a.name} (${a.id})`).join(' + ')}`);
  saveProject(project);

  if (backendType === 'supabase' && autoApplySql && project.backend.sql.trim()) {
    try { await applyBackend(project, settings, log); } catch (e) { log(`⚠️ لم يتم تطبيق SQL تلقائياً: ${e.message} — يمكنك تطبيقه من صفحة المشروع`); }
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

export async function applyBackend(project, settings, log) {
  const t = backendTarget(project, settings);
  if (t.type !== 'supabase') throw new Error('تطبيق SQL متاح لمشاريع Supabase فقط');
  log(`🗄️ تنفيذ SQL على Supabase (${t.label})...`);
  await supa.runSql(t.token, t.ref, project.backend.sql);
  project.backend.applied = true;
  project.backend.anonKey = await supa.getAnonKey(t.token, t.ref);
  saveProject(project);
  log('✅ تم إنشاء الجداول والصلاحيات');
}

export async function editApp(project, appId, instruction, settings, log, preferred) {
  const app = project.apps.find((a) => a.id === appId);
  if (!app) throw new Error('التطبيق غير موجود');
  log(`✏️ تعديل "${app.name}": ${instruction.slice(0, 120)}`);
  const { system, prompt } = editPrompt(project, app, instruction);
  const r = await complete(settings, { system, prompt, preferred, log });
  const parsed = parseFiles(r.text);
  const n = applyFiles(project, app, parsed, log);
  if (!n && !parsed.deleted.length) throw new Error('لم يُرجع الذكاء الاصطناعي أي تعديل بالصيغة المطلوبة');
  project.history.push({ at: new Date().toISOString(), type: 'edit', app: appId, text: instruction, files: Object.keys(parsed.files) });
  saveProject(project);
  log(`✅ تم تعديل ${n} ملف`);
  return { changed: Object.keys(parsed.files), deleted: parsed.deleted };
}

export { slugify };
