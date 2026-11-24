// البناء: دفع المشروع لمستودع GitHub ← تشغيل Actions ← متابعة الحالة ← رابط/إرسال الـ APK.
import { GitHub } from './integrations/github.js';
import { assembleApp, workflow, ids } from './stacks.js';
import { publicBackendConfig } from './generator.js';
import { saveProject } from './store.js';
import { sendMail } from './integrations/mail.js';

export async function buildRepoFiles(project, settings) {
  const cfg = await publicBackendConfig(project, settings);
  const out = {};
  for (const app of project.apps) {
    const id = ids(project, app);
    for (const [p, c] of Object.entries(assembleApp(project, app, cfg))) out[`${id.dir}/${p}`] = c;
    out[`.github/workflows/${id.workflow}`] = workflow(project, app);
  }
  out[`projects/${project.slug}/README.md`] = `# ${project.name}\n\n${project.description}\n\nStack: ${project.stack} — Apps: ${project.apps.map((a) => `${a.name} (${a.id})`).join(', ')}\n`;
  return out;
}

export async function pushAndBuild(project, settings, log, appIds) {
  const gh = new GitHub(settings.github.token);
  const repoName = settings.github.repo || 'apk-app';
  log(`📦 تجهيز مستودع ${repoName}...`);
  const repo = await gh.ensureRepo(repoName, settings.github.private !== false);
  const files = await buildRepoFiles(project, settings);
  const prev = project.github?.pushedPaths || [];
  const toDelete = prev.filter((p) => !(p in files));
  log(`⬆️ دفع ${Object.keys(files).length} ملف${toDelete.length ? ` وحذف ${toDelete.length}` : ''}...`);
  const commit = await gh.commitFiles(repo, files, `APK Forge: ${project.name} (${project.stack})`, toDelete);
  project.github = { repo: repo.full_name, url: repo.html_url, lastCommit: commit.sha, pushedPaths: Object.keys(files) };

  const targets = project.apps.filter((a) => !appIds?.length || appIds.includes(a.id));
  for (const app of targets) {
    const id = ids(project, app);
    log(`🚀 تشغيل البناء: ${app.name}...`);
    await gh.dispatch(repo, id.workflow);
  }
  project.builds.unshift({ at: new Date().toISOString(), commit: commit.sha, apps: targets.map((a) => a.id) });
  project.builds = project.builds.slice(0, 20);
  saveProject(project);
  log(`✅ بدأ البناء على GitHub Actions — يستغرق عادة ${{ python: '15-30', flutter: '6-10', kotlin: '4-8' }[project.stack] || '3-6'} دقائق`);
  return { repo: repo.html_url, commit: commit.sha };
}

// حالة آخر عمليات البناء لكل تطبيق + روابط الـ APK
export async function buildStatus(project, settings) {
  if (!project.github?.repo) return { repo: null, apps: [] };
  const gh = new GitHub(settings.github.token);
  const apps = [];
  for (const app of project.apps) {
    const id = ids(project, app);
    const runs = await gh.runs(project.github.repo, id.workflow, 3);
    const items = [];
    for (const r of runs) {
      const item = { id: r.id, number: r.run_number, status: r.status, conclusion: r.conclusion, url: r.html_url, createdAt: r.created_at };
      if (r.conclusion === 'success') {
        const rel = await gh.releaseByTag(project.github.repo, id.tagPrefix + r.run_number);
        const asset = rel?.assets?.find((a) => a.name.endsWith('.apk'));
        if (asset) item.apk = { assetId: asset.id, name: asset.name, size: asset.size, publicUrl: asset.browser_download_url, releaseUrl: rel.html_url };
      }
      items.push(item);
    }
    apps.push({ id: app.id, name: app.name, runs: items });
  }
  return { repo: project.github.url, apps };
}

export async function downloadApk(project, settings, assetId) {
  const gh = new GitHub(settings.github.token);
  return gh.downloadAsset(project.github.repo, assetId);
}

const MAX_ATTACH = 20 * 1024 * 1024;

export async function notifyClient(project, settings, { to, message }, log) {
  const status = await buildStatus(project, settings);
  const gh = new GitHub(settings.github.token);
  const attachments = [];
  const links = [];
  for (const a of status.apps) {
    const apk = a.runs.find((r) => r.apk)?.apk;
    if (!apk) { log(`⚠️ لا يوجد APK جاهز لـ ${a.name}`); continue; }
    links.push(`<li><b>${escapeHtml(a.name)}</b>: <a href="${apk.publicUrl}">${escapeHtml(apk.name)}</a></li>`);
    if (apk.size <= MAX_ATTACH) {
      const res = await gh.downloadAsset(project.github.repo, apk.assetId);
      attachments.push({ filename: `${project.slug}-${a.id}.apk`, content: Buffer.from(await res.arrayBuffer()) });
    }
  }
  if (!links.length) throw new Error('لا توجد ملفات APK جاهزة بعد — انتظر انتهاء البناء');
  log(`✉️ إرسال إلى ${to} (${attachments.length} مرفق)...`);
  await sendMail(settings, {
    to,
    subject: `تطبيقك جاهز: ${project.name}`,
    html: `<div dir="rtl" style="font-family:Tahoma,Arial">
      <h2>${escapeHtml(project.name)}</h2>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <p>ملفات التثبيت مرفقة بهذه الرسالة${settings.github.private !== false ? '' : ' ومتاحة أيضاً عبر الروابط'}:</p>
      <ul>${links.join('')}</ul>
      <p style="color:#666;font-size:12px">لتثبيت التطبيق: افتح ملف APK على جوال أندرويد واسمح بالتثبيت من مصادر غير معروفة.</p>
    </div>`,
    attachments,
  });
  log('✅ تم الإرسال');
  return { sent: true, attachments: attachments.length };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
