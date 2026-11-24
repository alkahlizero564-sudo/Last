// تخزين المشاريع كملفات JSON داخل data/projects، والمهام الطويلة في الذاكرة.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './settings.js';

const dir = () => path.join(DATA_DIR, 'projects');
const file = (id) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('معرّف مشروع غير صالح');
  return path.join(dir(), `${id}.json`);
};

export function slugify(name) {
  const s = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return s || 'app';
}

export function newId(name) { return `${slugify(name)}-${crypto.randomBytes(3).toString('hex')}`; }

export function listProjects() {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8'));
    return { id: p.id, name: p.name, stack: p.stack, mode: p.mode, backend: p.backend?.type, apps: p.apps.map((a) => a.name), updatedAt: p.updatedAt };
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function getProject(id) {
  const f = file(id);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function saveProject(p) {
  fs.mkdirSync(dir(), { recursive: true });
  p.updatedAt = new Date().toISOString();
  fs.writeFileSync(file(p.id), JSON.stringify(p, null, 2));
  return p;
}

export function deleteProject(id) {
  const f = file(id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ---------- المهام ----------
const jobs = new Map();

export function startJob(kind, fn) {
  const id = crypto.randomUUID();
  const job = { id, kind, status: 'running', log: [], result: null, error: null, startedAt: Date.now() };
  jobs.set(id, job);
  const log = (msg) => { job.log.push({ t: Date.now(), msg }); };
  Promise.resolve().then(() => fn(log)).then((r) => { job.result = r; job.status = 'done'; }).catch((e) => {
    job.error = e.message; job.status = 'error'; log(`❌ ${e.message}`);
  });
  // تنظيف المهام القديمة
  for (const [k, j] of jobs) if (Date.now() - j.startedAt > 6 * 3600e3) jobs.delete(k);
  return job;
}

export function getJob(id) { return jobs.get(id) || null; }
