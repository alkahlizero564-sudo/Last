// إدارة الإعدادات والمفاتيح السرية.
// المصدر: متغيرات البيئة (.env) كقيم افتراضية، ثم data/settings.json (يُحفظ من الواجهة).
// المفاتيح لا تُرسل للواجهة أبداً كاملة، بل مقنّعة (••••abcd).
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = () => path.join(DATA_DIR, 'settings.json');
export const MASK = '••••';

// الحقول السرية التي يجب تقنيعها
const SECRET_FIELDS = [
  'supabase.token', 'firebase.apiKey', 'github.token',
  'gemini.keys.0', 'gemini.keys.1', 'gemini.keys.2',
  'claude.key', 'openrouter.key', 'groq.key',
  'gmail.appPassword', 'brevo.key',
];

export function defaults(env = process.env) {
  return {
    supabase: { token: env.SUPABASE_ACCESS_TOKEN || '', ref: env.SUPABASE_PROJECT_REF || '' },
    firebase: { dbUrl: env.FIREBASE_DB_URL || '', apiKey: env.FIREBASE_API_KEY || '' },
    github: { token: env.GITHUB_TOKEN || '', repo: env.GITHUB_REPO || 'apk-app', private: env.GITHUB_PRIVATE !== 'false' },
    gemini: {
      keys: [env.GEMINI_API_KEY || '', env.GEMINI_API_KEY_2 || '', env.GEMINI_API_KEY_3 || ''],
      model: env.GEMINI_MODEL || '',
    },
    claude: { key: env.ANTHROPIC_API_KEY || '', model: env.CLAUDE_MODEL || '' },
    openrouter: { key: env.OPENROUTER_API_KEY || '', model: env.OPENROUTER_MODEL || '' },
    groq: { key: env.GROQ_API_KEY || '', model: env.GROQ_MODEL || '' },
    ai: { order: (env.AI_ORDER || 'gemini,claude,openrouter,groq').split(',').map((s) => s.trim()).filter(Boolean) },
    mail: { provider: env.MAIL_PROVIDER || 'gmail' },
    gmail: { user: env.GMAIL_USER || '', appPassword: env.GMAIL_APP_PASSWORD || '' },
    brevo: { login: env.BREVO_LOGIN || '', sender: env.BREVO_SENDER || '', key: env.BREVO_SMTP_KEY || '' },
    // مشاريع الزبائن: [{ name, ref, token }]
    clients: [],
  };
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

// fillEmpty=true: القيم الفارغة في over لا تلغي قيم base (لدمج الملف المحفوظ فوق .env)
function deepMerge(base, over, fillEmpty = false) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) && Array.isArray(over)) {
    if (!fillEmpty) return over;
    return base.length >= over.length && base.every((x) => typeof x === 'string')
      ? base.map((b, i) => (over[i] ? over[i] : b)) : over;
  }
  if (!isObj(base) || !isObj(over)) return fillEmpty && over === '' ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? deepMerge(base[k], over[k], fillEmpty) : over[k];
  return out;
}

function getPath(obj, p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, p, v) {
  const ks = p.split('.'); let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks.at(-1)] = v;
}

export function maskValue(v) {
  if (!v) return '';
  return MASK + String(v).slice(-4);
}

let cache = null;

export function loadSettings() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* أول تشغيل */ }
  cache = deepMerge(defaults(), saved, true);
  return cache;
}

export function resetCache() { cache = null; }

// نسخة آمنة للعرض في الواجهة
export function publicSettings(s = loadSettings()) {
  const copy = structuredClone(s);
  for (const f of SECRET_FIELDS) {
    const v = getPath(copy, f);
    if (v !== undefined) setPath(copy, f, maskValue(v));
  }
  copy.clients = (copy.clients || []).map((c) => ({ ...c, token: maskValue(c.token) }));
  return copy;
}

// حفظ تحديثات الواجهة: أي قيمة مقنّعة تعني "اترك القيمة الحالية كما هي"
export function saveSettings(update) {
  const current = loadSettings();
  const next = deepMerge(current, update || {});
  for (const f of SECRET_FIELDS) {
    const v = getPath(next, f);
    if (typeof v === 'string' && v.startsWith(MASK)) setPath(next, f, getPath(current, f));
    if (typeof v === 'string') setPath(next, f, getPath(next, f).trim());
  }
  if (Array.isArray(update?.clients)) {
    next.clients = update.clients.map((c, i) => {
      const token = String(c.token || '').startsWith(MASK) ? (current.clients[i]?.token || '') : String(c.token || '').trim();
      return { name: String(c.name || '').trim(), ref: String(c.ref || '').trim(), token };
    }).filter((c) => c.name || c.ref);
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(next, null, 2), { mode: 0o600 });
  cache = next;
  return next;
}

// تحقق سريع من صيغ المفاتيح (تحذيرات فقط)
export function validateSettings(s = loadSettings()) {
  const warn = [];
  const chk = (val, ok, msg) => { if (val && !ok(val)) warn.push(msg); };
  chk(s.supabase.token, (v) => v.startsWith('sbp_'), 'مفتاح Supabase يجب أن يبدأ بـ sbp_');
  chk(s.supabase.ref, (v) => /^[a-z]{20}$/.test(v), 'Supabase project ref يجب أن يكون 20 حرفاً صغيراً');
  chk(s.firebase.dbUrl, (v) => /^https:\/\/.+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(v), 'رابط Firebase غير صحيح');
  chk(s.github.token, (v) => /^(ghp_|github_pat_)/.test(v), 'مفتاح GitHub يجب أن يبدأ بـ ghp_ أو github_pat_');
  s.gemini.keys.forEach((k, i) => chk(k, (v) => v.startsWith('AIza'), `مفتاح Gemini ${i + 1} يجب أن يبدأ بـ AIza`));
  chk(s.claude.key, (v) => v.startsWith('sk-ant-'), 'مفتاح Claude يجب أن يبدأ بـ sk-ant-');
  chk(s.openrouter.key, (v) => v.startsWith('sk-or-'), 'مفتاح OpenRouter يجب أن يبدأ بـ sk-or-');
  chk(s.groq.key, (v) => v.startsWith('gsk_'), 'مفتاح Groq يجب أن يبدأ بـ gsk_');
  chk(s.brevo.key, (v) => v.startsWith('xsmtpsib-'), 'مفتاح Brevo SMTP يجب أن يبدأ بـ xsmtpsib-');
  chk(s.gmail.appPassword, (v) => v.replace(/\s/g, '').length === 16, 'كلمة سر تطبيقات Gmail يجب أن تكون 16 حرفاً');
  s.clients.forEach((c) => {
    chk(c.token, (v) => v.startsWith('sbp_'), `مفتاح الزبون "${c.name}" يجب أن يبدأ بـ sbp_`);
    chk(c.ref, (v) => /^[a-z]{20}$/.test(v), `رمز مشروع الزبون "${c.name}" يجب أن يكون 20 حرفاً`);
  });
  return warn;
}
