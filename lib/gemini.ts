// Google Gemini (Generative Language API) client.
// Free-tier friendly: uses GEMINI_API_KEY (or GOOGLE_API_KEY) and the
// gemini-3.6-flash / gemini-3.5-flash-lite models. Supports optional product
// images by fetching them and inlining as base64 (Gemini does not accept image
// URLs). Thinking is disabled so the whole token budget goes to the answer.

import { abacusGenerate } from './abacus';

// MULTI-KEY FAILOVER: you can configure several API keys. When one key hits its
// free-tier quota / rate limit (HTTP 429/403/5xx), the client automatically
// retries the same request with the next configured key, so generation keeps
// working. Configure keys in either (or both) of these ways:
//   - Comma-separated:  GEMINI_API_KEY=key1,key2,key3
//   - Numbered extras:  GEMINI_API_KEY_2=...  GEMINI_API_KEY_3=...  (up to _10)

// Returns every configured key, de-duplicated, in priority order.
export function getGeminiKeys(): string[] {
  const keys: string[] = [];
  const push = (v?: string | null) => {
    if (!v) return;
    for (const part of v.split(',')) {
      const k = part.trim();
      if (k && !keys.includes(k)) keys.push(k);
    }
  };
  push(process.env.GEMINI_API_KEY);
  push(process.env.GOOGLE_API_KEY);
  for (let i = 2; i <= 10; i++) {
    push(process.env[`GEMINI_API_KEY_${i}`]);
    push(process.env[`GOOGLE_API_KEY_${i}`]);
  }
  return keys;
}

export function getGeminiKey(): string | null {
  return getGeminiKeys()[0] || null;
}

// Statuses that mean "this key is exhausted / throttled" — worth retrying with
// the next configured key rather than giving up.
function isQuotaOrTransient(status: number): boolean {
  return status === 429 || status === 403 || status === 500 || status === 503;
}

// Primary (vision-capable) then fallback model.
export const GEMINI_PRIMARY = 'gemini-3.6-flash';
export const GEMINI_FALLBACK = 'gemini-3.5-flash-lite';

type InlineImage = { mime_type: string; data: string };

async function fetchImageInline(url?: string | null): Promise<InlineImage | null> {
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').split(';')[0].trim();
    const mime = ct.startsWith('image/') ? ct : 'image/jpeg';
    const buf = Buffer.from(await resp.arrayBuffer());
    // Skip images that are too large to inline safely (~4MB of raw bytes).
    if (buf.length > 4 * 1024 * 1024) return null;
    return { mime_type: mime, data: buf.toString('base64') };
  } catch {
    return null;
  }
}

// Calls Gemini once and returns the raw text content (expected JSON), or null.
export async function geminiGenerate(
  apiKey: string,
  model: string,
  instructions: string,
  imageUrl: string | null | undefined,
  maxTokens: number,
  temperature: number,
  logPrefix = 'gemini',
): Promise<string | null> {
  // Build the ordered key list: the caller's key first, then any other
  // configured keys as automatic fallbacks.
  const configured = getGeminiKeys();
  const keys = [apiKey, ...configured.filter((k) => k && k !== apiKey)];

  const parts: any[] = [{ text: instructions }];
  const inline = await fetchImageInline(imageUrl);
  if (inline) parts.push({ inline_data: inline });

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: 'application/json',
      // Gemini 3.x are thinking models: without this the reasoning eats the
      // token budget and the JSON answer comes back empty/truncated.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${encodeURIComponent(key)}`;

    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e: any) {
      console.error(`[${logPrefix}] fetch error key#${i + 1} model=${model} image=${!!inline}:`, e?.message ?? e);
      if (i < keys.length - 1) continue;
      break; // last Gemini key failed -> try Abacus fallback below
    }

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      if (isQuotaOrTransient(resp.status) && i < keys.length - 1) {
        console.error(
          `[${logPrefix}] key#${i + 1} ${resp.status} model=${model} (quota/limit) -> switching to key#${i + 2}: ${t.slice(0, 200)}`,
        );
        continue;
      }
      console.error(`[${logPrefix}] Gemini ${resp.status} model=${model} key#${i + 1}: ${t.slice(0, 300)}`);
      break; // non-retryable Gemini error -> try Abacus fallback below
    }

    const json: any = await resp.json().catch(() => null);
    const text: string =
      json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') ?? '';
    if (text) return text;
    break; // empty Gemini response -> try Abacus fallback below
  }

  // Every Gemini key failed / returned empty -> final fallback to Abacus RouteLLM.
  const abacusText = await abacusGenerate(instructions, maxTokens, temperature, logPrefix);
  if (abacusText) {
    console.error(`[${logPrefix}] used Abacus RouteLLM fallback (Gemini unavailable)`);
    return abacusText;
  }

  return null;
}
