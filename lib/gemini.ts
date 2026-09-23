// Google Gemini (Generative Language API) client.
// Free-tier friendly: uses GEMINI_API_KEY (or GOOGLE_API_KEY) and the
// gemini-3.6-flash / gemini-3.5-flash-lite models. Supports optional product
// images by fetching them and inlining as base64 (Gemini does not accept image
// URLs). Thinking is disabled so the whole token budget goes to the answer.

export function getGeminiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
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
  const parts: any[] = [{ text: instructions }];
  const inline = await fetchImageInline(imageUrl);
  if (inline) parts.push({ inline_data: inline });

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          // Gemini 3.x are thinking models: without this the reasoning eats the
          // token budget and the JSON answer comes back empty/truncated.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
  } catch (e: any) {
    console.error(`[${logPrefix}] fetch error model=${model} image=${!!inline}:`, e?.message ?? e);
    return null;
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error(`[${logPrefix}] Gemini ${resp.status} model=${model}: ${t.slice(0, 300)}`);
    return null;
  }

  const json: any = await resp.json().catch(() => null);
  const text: string =
    json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') ?? '';
  return text || '';
}
