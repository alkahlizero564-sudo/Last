// تحليل ردود الذكاء الاصطناعي: صيغة ملفات بفواصل نصية (أمتن من JSON مع الكود) + JSON للخطط.

const FILE_RE = /^=== FILE: (.+?) ===[ \t]*\r?\n([\s\S]*?)\r?\n=== END FILE ===[ \t]*$/gm;
const DELETE_RE = /^=== DELETE: (.+?) ===[ \t]*$/gm;
const SQL_RE = /^=== SQL ===[ \t]*\r?\n([\s\S]*?)\r?\n=== END SQL ===[ \t]*$/m;
const NOTIF_RE = /^=== NOTIFICATIONS ===[ \t]*\r?\n([\s\S]*?)\r?\n=== END NOTIFICATIONS ===[ \t]*$/m;

// يزيل أسوار ``` إذا لفّ النموذج المحتوى بها
function unfence(content) {
  const m = content.match(/^\s*```[\w+-]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  return m ? m[1] : content;
}

export function safePath(p) {
  const clean = String(p).trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!clean || clean.startsWith('/') || clean.split('/').some((s) => s === '..' || s === '') || /[\0:*?"<>|]/.test(clean)) {
    return null;
  }
  return clean;
}

export function parseFiles(text) {
  const files = {};
  const deleted = [];
  const rejected = [];
  for (const m of text.matchAll(FILE_RE)) {
    const p = safePath(m[1]);
    if (p) files[p] = unfence(m[2]); else rejected.push(m[1]);
  }
  for (const m of text.matchAll(DELETE_RE)) {
    const p = safePath(m[1]);
    if (p) deleted.push(p);
  }
  const sql = (text.match(SQL_RE)?.[1] || '').trim();
  let notifications = [];
  const nm = text.match(NOTIF_RE);
  if (nm) { try { const v = JSON.parse(unfence(nm[1])); if (Array.isArray(v)) notifications = v; } catch { /* تجاهل */ } }
  return { files, deleted, rejected, sql: unfence(sql), notifications };
}

export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```/);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(candidate); } catch (e) {
    throw new Error(`تعذر قراءة رد الخطة كـ JSON: ${e.message}`);
  }
}

export function parseSql(text) {
  const m = text.match(/```(?:sql|postgresql|pgsql)?\s*\r?\n([\s\S]*?)\r?\n```/i);
  return (m ? m[1] : text).trim();
}
