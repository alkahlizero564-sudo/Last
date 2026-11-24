// مزوّدو الذكاء الاصطناعي: Gemini, Claude, OpenRouter, Groq
import Anthropic from '@anthropic-ai/sdk';

const TIMEOUT_MS = 10 * 60 * 1000;

export const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  claude: 'claude-opus-5-5',
  openrouter: 'openai/gpt-oss-120b:free',
  groq: 'openai/gpt-oss-120b',
};

export class ProviderError extends Error {
  constructor(provider, status, message) {
    super(`[${provider}] ${status || ''} ${message}`.trim());
    this.provider = provider;
    this.status = status;
  }
}

async function readError(res) {
  const t = await res.text().catch(() => '');
  try { const j = JSON.parse(t); return j.error?.message || j.message || t; } catch { return t.slice(0, 300); }
}

export async function callGemini({ key, model, system, prompt }) {
  const m = model || DEFAULT_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 65536 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new ProviderError('gemini', res.status, await readError(res));
  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new ProviderError('gemini', 0, `رد فارغ (${cand?.finishReason || data.promptFeedback?.blockReason || 'unknown'})`);
  return { text, model: m };
}

export async function callClaude({ key, model, system, prompt }) {
  const m = model || DEFAULT_MODELS.claude;
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 1 });
  try {
    // بث الرد لتجنب انتهاء المهلة مع المخرجات الطويلة، مع إعادة التوجيه التلقائي عند الرفض
    const stream = client.beta.messages.stream({
      model: m,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new ProviderError('claude', 0, 'رفض النموذج الطلب');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new ProviderError('claude', 0, `رد فارغ (${msg.stop_reason})`);
    return { text, model: msg.model || m };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Anthropic.APIError) throw new ProviderError('claude', e.status, e.message);
    throw new ProviderError('claude', 0, e.message);
  }
}

async function callOpenAICompatible(provider, baseUrl, { key, model, system, prompt, extraHeaders = {} }) {
  const m = model || DEFAULT_MODELS[provider];
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...extraHeaders },
    body: JSON.stringify({
      model: m,
      max_tokens: 32000,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new ProviderError(provider, res.status, await readError(res));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new ProviderError(provider, 0, `رد فارغ (${data.choices?.[0]?.finish_reason || 'unknown'})`);
  return { text, model: data.model || m };
}

export const callOpenRouter = (o) => callOpenAICompatible('openrouter', 'https://openrouter.ai/api/v1', {
  ...o, extraHeaders: { 'X-Title': 'APK Forge' },
});
export const callGroq = (o) => callOpenAICompatible('groq', 'https://api.groq.com/openai/v1', o);
