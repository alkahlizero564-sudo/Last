// Supabase Management API: التحقق من المشروع، جلب المفتاح العام (anon)، وتنفيذ SQL.
// مفتاح الوصول (sbp_) يبقى على الخادم فقط ولا يُضمّن أبداً في التطبيقات المولّدة.
const API = 'https://api.supabase.com/v1';

async function call(token, method, path, body, fetchImpl = fetch) {
  const res = await fetchImpl(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${data?.message || data?.error || text}`);
  return data;
}

export function supabaseUrl(ref) { return `https://${ref}.supabase.co`; }

export async function getProject(token, ref, f) { return call(token, 'GET', `/projects/${ref}`, null, f); }

export async function getAnonKey(token, ref, f) {
  const keys = await call(token, 'GET', `/projects/${ref}/api-keys`, null, f);
  const k = keys.find((x) => x.name === 'anon') || keys.find((x) => x.type === 'publishable');
  if (!k?.api_key) throw new Error('لم يتم العثور على مفتاح anon لمشروع Supabase');
  return k.api_key;
}

export async function runSql(token, ref, query, f) {
  return call(token, 'POST', `/projects/${ref}/database/query`, { query }, f);
}
