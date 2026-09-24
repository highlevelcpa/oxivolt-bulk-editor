// Abacus.AI RouteLLM client — used as a FINAL fallback for the AI editing
// features. When every configured Gemini key is exhausted (quota / rate limit)
// or errors out, the app falls back to RouteLLM so generation keeps working.
//
// Configure with ABACUS_API_KEY (or ABACUSAI_API_KEY). Get a key at
// https://apps.abacus.ai/ -> API Keys. OpenAI-compatible chat completions.

export function getAbacusKey(): string | null {
  return process.env.ABACUS_API_KEY || process.env.ABACUSAI_API_KEY || null;
}

const ABACUS_ENDPOINT = 'https://apps.abacus.ai/v1/chat/completions';
// Router model — automatically picks a capable model behind the scenes.
const ABACUS_MODEL = 'route-llm';

// Calls RouteLLM once and returns the raw text content (expected JSON), or null.
// Text-only: product images are not inlined for this fallback path.
export async function abacusGenerate(
  instructions: string,
  maxTokens: number,
  temperature: number,
  logPrefix = 'abacus',
): Promise<string | null> {
  const key = getAbacusKey();
  if (!key) return null;

  let resp: Response;
  try {
    resp = await fetch(ABACUS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: ABACUS_MODEL,
        messages: [{ role: 'user', content: instructions }],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e: any) {
    console.error(`[${logPrefix}] abacus fetch error:`, e?.message ?? e);
    return null;
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error(`[${logPrefix}] Abacus ${resp.status}: ${t.slice(0, 300)}`);
    return null;
  }

  const json: any = await resp.json().catch(() => null);
  const text: string = json?.choices?.[0]?.message?.content ?? '';
  return text || '';
}
