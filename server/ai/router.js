// موجّه الذكاء الاصطناعي: يجرب المزودين بالترتيب، ويدوّر مفاتيح Gemini عند تجاوز الحصة أو الفشل.
import { callGemini, callClaude, callOpenRouter, callGroq } from './providers.js';

export const PROVIDERS = { gemini: callGemini, claude: callClaude, openrouter: callOpenRouter, groq: callGroq };

// يبني قائمة المحاولات (مزود + مفتاح + نموذج) من الإعدادات
export function buildAttempts(settings, preferred) {
  const order = [...(settings.ai?.order || [])];
  for (const p of Object.keys(PROVIDERS)) if (!order.includes(p)) order.push(p);
  if (preferred && order.includes(preferred)) order.splice(order.indexOf(preferred), 1), order.unshift(preferred);

  const attempts = [];
  for (const p of order) {
    if (p === 'gemini') {
      settings.gemini.keys.filter(Boolean).forEach((key, i) =>
        attempts.push({ provider: 'gemini', key, model: settings.gemini.model, label: `gemini#${i + 1}` }));
    } else if (settings[p]?.key) {
      attempts.push({ provider: p, key: settings[p].key, model: settings[p].model, label: p });
    }
  }
  return attempts;
}

export async function complete(settings, { system, prompt, preferred, log = () => {}, providers = PROVIDERS }) {
  const attempts = buildAttempts(settings, preferred);
  if (!attempts.length) throw new Error('لا يوجد أي مفتاح ذكاء اصطناعي مضبوط. أضف مفتاح Gemini أو Claude أو OpenRouter أو Groq من الإعدادات.');
  const errors = [];
  for (const a of attempts) {
    try {
      log(`🤖 جاري الطلب من ${a.label}${a.model ? ` (${a.model})` : ''}...`);
      const r = await providers[a.provider]({ key: a.key, model: a.model, system, prompt });
      log(`✅ رد ${a.label} (${r.model})`);
      return { ...r, provider: a.label };
    } catch (e) {
      log(`⚠️ فشل ${a.label}: ${e.message.slice(0, 200)} — الانتقال للتالي`);
      errors.push(e.message);
    }
  }
  throw new Error(`فشلت كل مزودات الذكاء الاصطناعي:\n${errors.join('\n')}`);
}
