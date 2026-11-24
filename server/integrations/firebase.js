// Firebase Realtime Database عبر REST: فحص الاتصال وتطبيق قواعد الأمان.
// تطبيق القواعد تلقائياً يحتاج "Database secret" (Project settings ← Service accounts ← Database secrets).
// القواعد تُدمج مع القواعد الحالية ولا تستبدلها، حتى لا تتأثر مشاريع أخرى على نفس القاعدة.

const base = (dbUrl) => dbUrl.replace(/\/$/, '');

export async function testFirebase(dbUrl, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(`${base(dbUrl)}/.json?shallow=true`);
  if (res.ok) return { ok: true, message: 'الاتصال بقاعدة Firebase ناجح والقراءة مسموحة' };
  if (res.status === 401) return { ok: true, message: 'القاعدة موجودة لكن القواعد تمنع القراءة العامة — أضف Database secret ليطبّق النظام القواعد تلقائياً' };
  return { ok: false, message: `Firebase ${res.status}: ${await res.text()}` };
}

// قواعد صندوق الإشعارات: كل تطبيق يكتب لصندوق غيره ويقرأ صندوقه
export const NOTIFICATION_RULES = {
  $project: {
    $app: {
      '.read': true,
      '.write': true,
      $id: {
        '.validate': "newData.hasChildren(['title','from']) && newData.child('title').isString() && newData.child('title').val().length <= 200",
      },
    },
  },
};

// يزيل التعليقات من قواعد Firebase (مسموح بها في ملف القواعد) قبل JSON.parse
export function stripRuleComments(text) {
  let out = ''; let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { out += c; if (c === '\\') { out += text[++i] ?? ''; } else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out;
}

export function mergeRules(current, { notifications = false, projectSlug, projectRules } = {}) {
  const merged = structuredClone(current && current.rules ? current : { rules: {} });
  if (notifications) {
    merged.rules.notifications = { ...(merged.rules.notifications || {}), ...NOTIFICATION_RULES };
  }
  if (projectSlug && projectRules) {
    // قواعد بيانات المشروع تُحصر في مسار المشروع
    const r = projectRules.rules || projectRules;
    merged.rules[projectSlug] = r[projectSlug] || r;
  }
  return merged;
}

export async function getRules(dbUrl, secret, fetchImpl = fetch) {
  const res = await fetchImpl(`${base(dbUrl)}/.settings/rules.json?auth=${encodeURIComponent(secret)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Firebase ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(stripRuleComments(text));
}

export async function putRules(dbUrl, secret, rules, fetchImpl = fetch) {
  const res = await fetchImpl(`${base(dbUrl)}/.settings/rules.json?auth=${encodeURIComponent(secret)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rules),
  });
  if (!res.ok) throw new Error(`Firebase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function applyRules(dbUrl, secret, opts, fetchImpl = fetch) {
  const current = await getRules(dbUrl, secret, fetchImpl);
  const merged = mergeRules(current, opts);
  await putRules(dbUrl, secret, merged, fetchImpl);
  return merged;
}
