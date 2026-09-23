// Uses the vision-capable LLM to classify a product into a concise, standard
// retail category search term based on its image, title, type and description.
// Robust: logs failures, retries text-only, and falls back to a second model.

export type ProductForCategorize = {
  id: string;
  title: string;
  productType?: string | null;
  description?: string | null;
  imageUrl?: string | null;
};

export type Classification = {
  category: string;
  search: string;
};

function stripHtml(html?: string | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseClassification(raw: string): Classification | null {
  if (!raw) return null;
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (parsed && typeof parsed === 'object') {
    const category = (parsed.category || parsed.search || '').toString().trim();
    const search = (parsed.search || parsed.category || '').toString().trim();
    if (search) return { category: category || search, search };
  }

  // Salvage truncated / malformed JSON (e.g. `{"category": "Handbags",`) by
  // pulling the field values out with a regex. Keeps categorization working even
  // when the model response is cut off before the closing brace.
  const catMatch = raw.match(/"category"\s*:\s*"([^"]+)"/i);
  const searchMatch = raw.match(/"search"\s*:\s*"([^"]+)"/i);
  const category = (catMatch?.[1] || searchMatch?.[1] || '').trim();
  const search = (searchMatch?.[1] || catMatch?.[1] || '').trim();
  if (search) return { category: category || search, search };

  return null;
}

async function callLlm(
  apiKey: string,
  model: string,
  instructions: string,
  imageUrl?: string | null,
): Promise<Classification | null> {
  const content: any[] = [{ type: 'text', text: instructions }];
  if (imageUrl) {
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  let resp: Response;
  try {
    resp = await fetch('https://apps.abacus.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        max_tokens: 600,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e: any) {
    console.error(`[categorize] fetch error model=${model} image=${!!imageUrl}:`, e?.message ?? e);
    return null;
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error(`[categorize] LLM ${resp.status} model=${model} image=${!!imageUrl}: ${t.slice(0, 300)}`);
    return null;
  }

  const json: any = await resp.json().catch(() => null);
  const raw: string = json?.choices?.[0]?.message?.content ?? '';
  const parsed = parseClassification(raw);
  if (!parsed) {
    console.error(
      `[categorize] unparseable model=${model} image=${!!imageUrl} raw=${String(raw).slice(0, 300)}`,
    );
  }
  return parsed;
}

export async function classifyProductCategory(
  p: ProductForCategorize,
): Promise<Classification | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API key is not configured on the server');

  const desc = stripHtml(p.description).slice(0, 600);
  const textInfo =
    `Product title: ${p.title || 'N/A'}\n` +
    `Product type: ${p.productType || 'N/A'}\n` +
    `Description: ${desc || 'N/A'}`;

  const instructions =
    `You are an expert in Shopify's Standard Product Taxonomy. ` +
    `Look at the product image (if provided) and the text details, then decide the single most ` +
    `appropriate and specific product category. ` +
    `Use common English retail category names as they appear in Shopify's taxonomy ` +
    `(for example: "Cross Body Bags", "Running Shoes", "Coffee Mugs", "T-Shirts"). ` +
    `Always make your best guess from whatever information is available; never refuse. ` +
    `Respond with raw JSON only, no markdown, in this exact shape: ` +
    `{"category": "<specific category name>", "search": "<2-4 word search term to find it in Shopify's taxonomy>"}.` +
    `\n\n${textInfo}`;

  // Attempt 1: primary model WITH image (if any).
  let result = await callLlm(apiKey, 'gemini-3.8-flash', instructions, p.imageUrl);
  if (result) return result;

  // Attempt 2: primary model TEXT-ONLY (image may be inaccessible/too large).
  if (p.imageUrl) {
    result = await callLlm(apiKey, 'gemini-3.8-flash', instructions, null);
    if (result) return result;
  }

  // Attempt 3: fallback model TEXT-ONLY.
  result = await callLlm(apiKey, 'gpt-5.4-mini', instructions, null);
  if (result) return result;

  console.error(`[categorize] all attempts failed for product ${p.id} "${p.title}"`);
  return null;
}
