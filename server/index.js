// خادم APK Forge: واجهة الويب + API.
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { loadSettings, saveSettings, publicSettings, validateSettings } from './settings.js';
import { listProjects, getProject, saveProject, deleteProject, startJob, getJob } from './store.js';
import { createProject, editApp, applyBackend, publicBackendConfig, generateApp } from './generator.js';
import { pushAndBuild, buildStatus, downloadApk, notifyClient } from './builder.js';
import { STACKS, assembleApp, configPath, isAllowedPath } from './stacks.js';
import { PROVIDERS, buildAttempts } from './ai/router.js';
import { GitHub } from './integrations/github.js';
import * as supa from './integrations/supabase.js';
import { testFirebase } from './integrations/firebase.js';
import { verifyMail, sendMail } from './integrations/mail.js';
import { safePath } from './ai/parse.js';

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  // ---------- حماية بكلمة مرور (ADMIN_PASSWORD) ----------
  const ADMIN = process.env.ADMIN_PASSWORD || '';
  const safeEq = (a, b) => {
    const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  app.use('/api', (req, res, next) => {
    if (!ADMIN || req.path === '/auth') return next();
    if (safeEq(req.get('x-admin-password') || '', ADMIN)) return next();
    res.status(401).json({ error: 'unauthorized' });
  });
  app.get('/api/auth', (req, res) => res.json({ required: !!ADMIN }));

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 400).json({ error: e.message }));
  const mustProject = (id) => {
    const p = getProject(id);
    if (!p) throw Object.assign(new Error('المشروع غير موجود'), { status: 404 });
    return p;
  };

  // ---------- عام ----------
  app.get('/api/meta', (req, res) => res.json({ stacks: STACKS, providers: Object.keys(PROVIDERS) }));

  // ---------- الإعدادات ----------
  app.get('/api/settings', (req, res) => res.json({ settings: publicSettings(), warnings: validateSettings() }));
  app.put('/api/settings', wrap((req, res) => {
    saveSettings(req.body);
    res.json({ settings: publicSettings(), warnings: validateSettings() });
  }));

  app.post('/api/settings/test/:what', wrap(async (req, res) => {
    const s = loadSettings();
    const what = req.params.what;
    if (what === 'github') {
      const me = await new GitHub(s.github.token).me();
      return res.json({ ok: true, message: `متصل كـ ${me.login}` });
    }
    if (what === 'supabase' || what === 'client') {
      const c = what === 'client' ? s.clients.find((x) => x.ref === req.body.ref) : s.supabase;
      if (!c?.token || !c?.ref) throw new Error('البيانات ناقصة');
      const p = await supa.getProject(c.token, c.ref);
      return res.json({ ok: true, message: `مشروع "${p.name}" (${p.region}) — ${p.status}` });
    }
    if (what === 'firebase') {
      if (!s.firebase.dbUrl) throw new Error('رابط Firebase غير مضبوط');
      return res.json(await testFirebase(s.firebase.dbUrl, s.firebase.apiKey));
    }
    if (what === 'mail') {
      await verifyMail(s);
      if (req.body?.to) await sendMail(s, { to: req.body.to, subject: 'APK Forge — رسالة تجريبية', html: '<p dir="rtl">إعدادات البريد تعمل ✅</p>' });
      return res.json({ ok: true, message: req.body?.to ? 'تم إرسال رسالة تجريبية' : 'الاتصال بخادم البريد ناجح' });
    }
    if (what === 'ai') {
      const attempts = buildAttempts(s);
      const only = req.body?.label;
      const results = [];
      for (const a of attempts.filter((x) => !only || x.label === only)) {
        try {
          const r = await PROVIDERS[a.provider]({ key: a.key, model: a.model, system: 'Reply with one word.', prompt: 'Say OK' });
          results.push({ label: a.label, ok: true, model: r.model });
        } catch (e) { results.push({ label: a.label, ok: false, error: e.message.slice(0, 200) }); }
      }
      if (!results.length) throw new Error('لا توجد مفاتيح ذكاء اصطناعي');
      return res.json({ ok: results.some((r) => r.ok), results });
    }
    throw new Error('اختبار غير معروف');
  }));

  // ---------- المشاريع ----------
  app.get('/api/projects', (req, res) => res.json(listProjects()));

  app.post('/api/projects', wrap((req, res) => {
    const job = startJob('create', (log) => createProject(req.body, loadSettings(), log));
    res.json({ jobId: job.id });
  }));

  app.get('/api/projects/:id', wrap(async (req, res) => {
    const p = mustProject(req.params.id);
    const s = loadSettings();
    let cfg;
    try { cfg = await publicBackendConfig(p, s); if (p.backend?.anonKey) saveProject(p); } catch (e) { cfg = { type: p.backend?.type || 'none', error: e.message }; }
    const generated = {};
    for (const a of p.apps) {
      const all = assembleApp(p, a, cfg);
      generated[a.id] = Object.fromEntries(Object.entries(all).filter(([k]) => !(k in a.files)));
    }
    res.json({ project: { ...p, backend: { ...p.backend } }, generated, backendConfigError: cfg.error || null, configPaths: Object.fromEntries(p.apps.map((a) => [a.id, configPath(p.stack, p, a)])) });
  }));

  app.delete('/api/projects/:id', wrap((req, res) => { deleteProject(req.params.id); res.json({ ok: true }); }));

  // حفظ تعديل يدوي على ملف
  app.put('/api/projects/:id/apps/:appId/files', wrap((req, res) => {
    const p = mustProject(req.params.id);
    const a = p.apps.find((x) => x.id === req.params.appId);
    if (!a) throw new Error('التطبيق غير موجود');
    const fp = safePath(req.body.path);
    if (!fp || !isAllowedPath(p.stack, fp, p, a)) throw new Error('مسار غير مسموح (الملفات الثابتة تُولّد تلقائياً)');
    if (req.body.delete) delete a.files[fp]; else a.files[fp] = String(req.body.content ?? '');
    saveProject(p);
    res.json({ ok: true });
  }));

  app.post('/api/projects/:id/apps/:appId/edit', wrap((req, res) => {
    const p = mustProject(req.params.id);
    if (!req.body.instruction?.trim()) throw new Error('اكتب التعديل المطلوب');
    const job = startJob('edit', (log) => editApp(p, req.params.appId, req.body.instruction, loadSettings(), log, req.body.preferred));
    res.json({ jobId: job.id });
  }));

  app.post('/api/projects/:id/apps/:appId/regenerate', wrap((req, res) => {
    const p = mustProject(req.params.id);
    const a = p.apps.find((x) => x.id === req.params.appId);
    if (!a) throw new Error('التطبيق غير موجود');
    const job = startJob('regenerate', async (log) => { a.files = {}; await generateApp(p, a, loadSettings(), log, req.body?.preferred); saveProject(p); });
    res.json({ jobId: job.id });
  }));

  app.put('/api/projects/:id/backend', wrap((req, res) => {
    const p = mustProject(req.params.id);
    if (typeof req.body.sql === 'string') { p.backend.sql = req.body.sql; p.backend.applied = false; }
    if (typeof req.body.contract === 'string') p.backend.contract = req.body.contract;
    saveProject(p);
    res.json({ ok: true });
  }));

  app.post('/api/projects/:id/backend/apply', wrap((req, res) => {
    const p = mustProject(req.params.id);
    const job = startJob('sql', (log) => applyBackend(p, loadSettings(), log));
    res.json({ jobId: job.id });
  }));

  // ---------- البناء ----------
  app.post('/api/projects/:id/build', wrap((req, res) => {
    const p = mustProject(req.params.id);
    const job = startJob('build', (log) => pushAndBuild(p, loadSettings(), log, req.body?.apps));
    res.json({ jobId: job.id });
  }));

  app.get('/api/projects/:id/builds', wrap(async (req, res) => res.json(await buildStatus(mustProject(req.params.id), loadSettings()))));

  app.get('/api/projects/:id/apk/:assetId', wrap(async (req, res) => {
    const p = mustProject(req.params.id);
    if (!/^\d+$/.test(req.params.assetId)) throw new Error('معرّف غير صالح');
    const r = await downloadApk(p, loadSettings(), req.params.assetId);
    res.setHeader('content-type', 'application/vnd.android.package-archive');
    res.setHeader('content-disposition', `attachment; filename="${p.slug}.apk"`);
    Readable.fromWeb(r.body).pipe(res);
  }));

  app.post('/api/projects/:id/notify', wrap((req, res) => {
    const p = mustProject(req.params.id);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body?.to || '')) throw new Error('إيميل غير صحيح');
    const job = startJob('notify', (log) => notifyClient(p, loadSettings(), req.body, log));
    res.json({ jobId: job.id });
  }));

  // ---------- المهام ----------
  app.get('/api/jobs/:id', (req, res) => {
    const j = getJob(req.params.id);
    if (!j) return res.status(404).json({ error: 'المهمة غير موجودة' });
    res.json(j);
  });

  // ---------- الملفات الثابتة ----------
  app.use('/shared', express.static(path.resolve('shared')));
  app.use(express.static(path.resolve('web')));
  return app;
}

// تشغيل مباشر
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.loadEnvFile('.env'); } catch { /* لا يوجد .env */ }
  const HOST = process.env.HOST || '127.0.0.1';
  const PORT = Number(process.env.PORT || 3000);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  if (!local && !process.env.ADMIN_PASSWORD) {
    console.error('⛔ للتشغيل على عنوان عام يجب ضبط ADMIN_PASSWORD لحماية مفاتيحك.');
    process.exit(1);
  }
  createServer().listen(PORT, HOST, () => console.log(`🚀 APK Forge يعمل على http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
}

