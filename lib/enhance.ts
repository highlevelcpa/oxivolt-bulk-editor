// AI generation of product descriptions and SEO metadata via the vision LLM.
// Robust: logs failures, retries text-only, and falls back to a second model.

export type ProductForEnhance = {
  id: string;
  title: string;
  vendor?: string | null;
  productType?: string | null;
  description?: string | null;
  category?: string | null;
  imageUrl?: string | null;
};

function stripHtml(html?: string | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseJsonLoose(raw: string): any {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
      // fall through
    }
  }
  return null;
}

async function callLlmRaw(
  apiKey: string,
  model: string,
  instructions: string,
  imageUrl: string | null | undefined,
  maxTokens: number,
): Promise<string | null> {
  const content: any[] = [{ type: 'text', text: instructions }];
  if (imageUrl) content.push({ type: 'image_url', image_url: { url: imageUrl } });

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
        max_tokens: maxTokens,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e: any) {
    console.error(`[enhance] fetch error model=${model} image=${!!imageUrl}:`, e?.message ?? e);
    return null;
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error(`[enhance] LLM ${resp.status} model=${model}: ${t.slice(0, 300)}`);
    return null;
  }

  const json: any = await resp.json().catch(() => null);
  return json?.choices?.[0]?.message?.content ?? '';
}

export async function generateDescription(p: ProductForEnhance): Promise<string | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API key is not configured on the server');

  const desc = stripHtml(p.description).slice(0, 800);
  const info =
    `Title: ${p.title || 'N/A'}\n` +
    `Vendor: ${p.vendor || 'N/A'}\n` +
    `Type: ${p.productType || 'N/A'}\n` +
    `Category: ${p.category || 'N/A'}\n` +
    `Existing description: ${desc || 'N/A'}`;

  const instructions =
    `You are an expert e-commerce copywriter. Write a compelling, professional product description ` +
    `for the store's product page. Use the product image (if provided) and the details below. ` +
    `Requirements: 60-120 words, persuasive but factual, highlight key benefits and use cases, ` +
    `do not invent specific specs you cannot see, and never mention any monetary amount. ` +
    `Return the description as clean HTML using ONLY <p>, <ul>, <li> and <strong> tags ` +
    `(one short paragraph plus a 3-4 item bullet list works well). ` +
    `Respond with raw JSON only, no markdown, in this exact shape: {"html": "<the description html>"}.` +
    `\n\n${info}`;

  let raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, p.imageUrl, 900);
  let parsed = parseJsonLoose(raw || '');
  if (!parsed && p.imageUrl) {
    raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, null, 900);
    parsed = parseJsonLoose(raw || '');
  }
  if (!parsed) {
    raw = await callLlmRaw(apiKey, 'gpt-5.4-mini', instructions, null, 900);
    parsed = parseJsonLoose(raw || '');
  }
  const html = (parsed?.html || parsed?.description || '').toString().trim();
  return html || null;
}

export async function generateTitle(p: ProductForEnhance): Promise<string | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API key is not configured on the server');

  const desc = stripHtml(p.description).slice(0, 500);
  const info =
    `Current title: ${p.title || 'N/A'}\n` +
    `Vendor: ${p.vendor || 'N/A'}\n` +
    `Type: ${p.productType || 'N/A'}\n` +
    `Category: ${p.category || 'N/A'}\n` +
    `Description: ${desc || 'N/A'}`;

  const instructions =
    `You are an expert e-commerce copywriter. Write an improved, clear and appealing product title ` +
    `for the store's product page. Use the product image (if provided) and the details below. ` +
    `Requirements: at most 70 characters, include the key product attribute and be easy to scan, ` +
    `Title Case, no ALL CAPS, no emojis, no quotation marks, no vendor/brand name unless it is ` +
    `essential, do not invent specs you cannot see, and never mention any monetary amount. ` +
    `Respond with raw JSON only, no markdown, in this exact shape: {"title": "<the new title>"}.` +
    `\n\n${info}`;

  let raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, p.imageUrl, 200);
  let parsed = parseJsonLoose(raw || '');
  if (!parsed && p.imageUrl) {
    raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, null, 200);
    parsed = parseJsonLoose(raw || '');
  }
  if (!parsed) {
    raw = await callLlmRaw(apiKey, 'gpt-5.4-mini', instructions, null, 200);
    parsed = parseJsonLoose(raw || '');
  }
  const title = (parsed?.title || parsed?.name || '').toString().trim().replace(/^["']|["']$/g, '').slice(0, 120);
  return title || null;
}

export async function generateTags(p: ProductForEnhance): Promise<string[] | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API key is not configured on the server');

  const desc = stripHtml(p.description).slice(0, 500);
  const info =
    `Title: ${p.title || 'N/A'}\n` +
    `Vendor: ${p.vendor || 'N/A'}\n` +
    `Type: ${p.productType || 'N/A'}\n` +
    `Category: ${p.category || 'N/A'}\n` +
    `Description: ${desc || 'N/A'}`;

  const instructions =
    `You are an e-commerce merchandising expert. Generate relevant product tags that help customers ` +
    `find and filter this product in an online store. Use the product image (if provided) and the ` +
    `details below. Requirements: 5-8 concise tags, each 1-3 words, lowercase, no duplicates, ` +
    `focus on product attributes, materials, use cases, style, audience and category. ` +
    `Do NOT include the vendor/brand name as a tag, do NOT invent specs you cannot see, ` +
    `and never mention any monetary amount. ` +
    `Respond with raw JSON only, no markdown, in this exact shape: {"tags": ["tag1", "tag2", ...]}.` +
    `\n\n${info}`;

  let raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, p.imageUrl, 300);
  let parsed = parseJsonLoose(raw || '');
  if (!parsed && p.imageUrl) {
    raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, null, 300);
    parsed = parseJsonLoose(raw || '');
  }
  if (!parsed) {
    raw = await callLlmRaw(apiKey, 'gpt-5.4-mini', instructions, null, 300);
    parsed = parseJsonLoose(raw || '');
  }
  let list: any = parsed?.tags ?? parsed?.Tags ?? null;
  if (typeof list === 'string') {
    list = list.split(',');
  }
  if (!Array.isArray(list)) return null;
  const clean = list
    .map((t: any) => (t == null ? '' : String(t).trim()))
    .filter((t: string) => t.length > 0 && t.length <= 40);
  // dedup case-insensitively, preserve order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of clean) {
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out.length > 0 ? out.slice(0, 12) : null;
}

// Turns any string into a URL-safe Shopify handle (lowercase, hyphen-separated,
// only letters/numbers/hyphens, max 60 chars).
function slugify(input: string): string {
  return (input || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export async function generateSeo(
  p: ProductForEnhance,
): Promise<{ title: string; description: string; handle: string } | null> {
  const apiKey = process.env.ABACUSAI_API_KEY;
  if (!apiKey) throw new Error('LLM API key is not configured on the server');

  const desc = stripHtml(p.description).slice(0, 600);
  const info =
    `Title: ${p.title || 'N/A'}\n` +
    `Vendor: ${p.vendor || 'N/A'}\n` +
    `Type: ${p.productType || 'N/A'}\n` +
    `Category: ${p.category || 'N/A'}\n` +
    `Description: ${desc || 'N/A'}`;

  const instructions =
    `You are an SEO expert. Generate search-optimized meta tags for this product page. ` +
    `Requirements: a meta title of at most 60 characters that includes the product name and a key ` +
    `attribute; a meta description of at most 155 characters that is compelling and keyword-rich; ` +
    `a URL handle (slug) that is short, keyword-rich, lowercase, hyphen-separated, made only of ` +
    `letters, numbers and hyphens (no spaces or special characters), at most 60 characters. ` +
    `Never mention any monetary amount. ` +
    `Respond with raw JSON only, no markdown, in this exact shape: ` +
    `{"title": "<meta title>", "description": "<meta description>", "handle": "<url-handle>"}.` +
    `\n\n${info}`;

  let raw = await callLlmRaw(apiKey, 'gemini-3.8-flash', instructions, null, 400);
  let parsed = parseJsonLoose(raw || '');
  if (!parsed) {
    raw = await callLlmRaw(apiKey, 'gpt-5.4-mini', instructions, null, 400);
    parsed = parseJsonLoose(raw || '');
  }
  const title = (parsed?.title || '').toString().trim().slice(0, 70);
  const description = (parsed?.description || '').toString().trim().slice(0, 320);
  const handle = slugify((parsed?.handle || parsed?.title || p.title || '').toString());
  if (!title && !description && !handle) return null;
  return { title, description, handle };
}
