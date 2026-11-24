// Firebase Realtime Database: فحص الاتصال عبر REST.
// ملاحظة: تطبيق قواعد الأمان يتطلب صلاحيات مدير، لذا نعرض القواعد المقترحة لينسخها المستخدم في لوحة Firebase.
export async function testFirebase(dbUrl, apiKey, fetchImpl = fetch) {
  const base = dbUrl.replace(/\/$/, '');
  const res = await fetchImpl(`${base}/.json?shallow=true`);
  if (res.ok) return { ok: true, message: 'الاتصال بقاعدة Firebase ناجح والقراءة مسموحة' };
  if (res.status === 401) return { ok: true, message: 'القاعدة موجودة لكن القواعد تمنع القراءة العامة — طبّق القواعد المقترحة من صفحة المشروع' };
  return { ok: false, message: `Firebase ${res.status}: ${await res.text()}` };
}
