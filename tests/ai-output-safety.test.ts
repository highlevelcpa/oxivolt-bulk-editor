// Regression tests for AI output safety (POST /api/products/enhance, lib/enhance,
// lib/gemini, lib/abacus): HTML sanitization, request timeouts and bounded
// concurrency. Everything external is mocked (fetch + Prisma); no network.
//
// Run: node --import tsx --test tests/*.test.ts
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { sanitizeDescriptionHtml, isEffectivelyEmptyHtml } from '../lib/sanitize-html';
import { mapWithConcurrency } from '../lib/concurrency';

const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const SHOP = 'test-shop.myshopify.com';
process.env.SHOPIFY_API_KEY = API_KEY;
process.env.SHOPIFY_API_SECRET = API_SECRET;
process.env.GEMINI_API_KEY = 'fake-gemini-key';
for (const k of Object.keys(process.env)) {
  if (/^(GEMINI|GOOGLE)_API_KEY_\d+$/.test(k) || k === 'GOOGLE_API_KEY') delete process.env[k];
}
delete process.env.ABACUS_API_KEY;
delete process.env.ABACUSAI_API_KEY;

const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const geminiText = (obj: any) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

let shopifyCalls: { query: string; variables: any }[] = [];
let geminiHandler: (init: any) => Promise<Response> | Response = () => new Response('{}', { status: 500 });
let geminiSignals: (AbortSignal | undefined)[] = [];
let abacusSignals: (AbortSignal | undefined)[] = [];
let abacusHandler: (init: any) => Promise<Response> | Response = () => new Response('nope', { status: 500 });
let inflight = 0;
let maxInflight = 0;
let usage: number[] = [];

(globalThis as any).fetch = async (url: any, init: any) => {
  const href = String(url);
  if (href.includes('generativelanguage.googleapis.com')) {
    geminiSignals.push(init?.signal);
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    try {
      return await geminiHandler(init);
    } finally {
      inflight--;
    }
  }
  if (href.includes('apps.abacus.ai')) {
    abacusSignals.push(init?.signal);
    return abacusHandler(init);
  }
  assert.ok(href.startsWith(`https://${SHOP}/admin/api/2026-04/graphql.json`), `unexpected fetch ${href}`);
  const body = JSON.parse(init?.body ?? '{}');
  shopifyCalls.push({ query: body.query, variables: body.variables });
  const q: string = body.query;
  if (q.includes('shop { id }')) return json({ data: { shop: { id: 'gid://shopify/Shop/1' } } });
  if (q.includes('currentAppInstallation')) {
    return json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', name: 'Pro', status: 'ACTIVE', lineItems: [] }] } } });
  }
  if (q.includes('nodes(')) {
    return json({ data: { nodes: body.variables.ids.map((id: string) => ({ id, title: 'T', handle: 'old-handle', tags: ['a'], seo: { title: null, description: null }, descriptionHtml: '<p>x</p>' })) } });
  }
  if (q.includes('productUpdate(')) return json({ data: { productUpdate: { product: { id: body.variables.product.id }, userErrors: [] } } });
  return json({ errors: [{ message: 'unexpected query in test' }] });
};

(globalThis as any).prisma = {
  shopSession: {
    findUnique: async () => ({ shop: SHOP, accessToken: 'fake-token', tokenExpiresAt: new Date(Date.now() + 3600_000) }),
    upsert: async () => ({}),
  },
  shopBilling: { findUnique: async () => null, upsert: async () => ({}) },
  editLog: { create: async ({ data }: any) => data },
  usageCounter: { upsert: async ({ create }: any) => { usage.push(create.count); return {}; } },
};

let enhancePOST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
before(async () => {
  NextRequestCtor = (await import('next/server')).NextRequest;
  enhancePOST = (await import('../app/api/products/enhance/route')).POST;
});
beforeEach(() => {
  shopifyCalls = []; geminiSignals = []; abacusSignals = []; usage = [];
  inflight = 0; maxInflight = 0;
  geminiHandler = () => new Response('{}', { status: 500 });
  abacusHandler = () => new Response('nope', { status: 500 });
  delete process.env.ABACUS_API_KEY;
});

const token = () => jwt.sign({ aud: API_KEY, dest: `https://${SHOP}` }, API_SECRET, { algorithm: 'HS256' });
const enhance = (productIds: string[], mode: string) =>
  enhancePOST(new NextRequestCtor('http://localhost/api/products/enhance', {
    method: 'POST',
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ productIds, mode }),
  }));
const updates = () => shopifyCalls.filter((c) => c.query.includes('productUpdate('));

// Makes AbortSignal.timeout(ms) fire after `fastMs` instead, for the duration of fn.
async function withFastTimeouts<T>(fastMs: number, fn: () => Promise<T>): Promise<T> {
  const original = AbortSignal.timeout;
  (AbortSignal as any).timeout = () => original.call(AbortSignal, fastMs);
  // AbortSignal.timeout uses an unref'd timer; in a real server the HTTP listener
  // keeps the event loop alive, here we need an explicit ref'd timer.
  const keepAlive = setInterval(() => {}, 10);
  try {
    return await fn();
  } finally {
    clearInterval(keepAlive);
    (AbortSignal as any).timeout = original;
  }
}
// A fetch that never responds unless its signal aborts (like a hung upstream).
const hangUntilAborted = (init: any) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')));
  });

// ---------------------------------------------------------------------------
// 1. sanitizeDescriptionHtml unit tests
// ---------------------------------------------------------------------------
test('sanitizer keeps allowlisted formatting tags', () => {
  const html = '<p>Great <strong>shoe</strong> and <em>light</em>.</p><ul><li>One</li><li>Two<br/>lines</li></ul><ol><li>x</li></ol>';
  assert.equal(
    sanitizeDescriptionHtml(html),
    '<p>Great <strong>shoe</strong> and <em>light</em>.</p><ul><li>One</li><li>Two<br>lines</li></ul><ol><li>x</li></ol>',
  );
});

test('sanitizer removes script/style/iframe/svg elements including their content', () => {
  const out = sanitizeDescriptionHtml('<p>A</p><script>steal()</script><style>p{}</style><iframe src="//x"></iframe><svg onload=alert(1)><circle/></svg><p>B</p>');
  assert.equal(out, '<p>A</p><p>B</p>');
});

test('sanitizer strips all attributes, event handlers and javascript: links', () => {
  const out = sanitizeDescriptionHtml('<p onclick="alert(1)" style="x" class="c">Hi</p><a href="javascript:alert(1)">link</a><img src=x onerror="alert(1)"><li data-x=1>i</li>');
  assert.equal(out, '<p>Hi</p>link<li>i</li>');
  assert.doesNotMatch(out, /onerror|onclick|javascript:|<img|<a\b|style=/i);
});

test('sanitizer handles unclosed / obfuscated tags without leaking markup', () => {
  assert.equal(sanitizeDescriptionHtml('<p>ok</p><script>never closed'), '<p>ok</p>');
  assert.equal(sanitizeDescriptionHtml('<SCRIPT >x</SCRIPT ><P>ok</P>'), '<p>ok</p>');
  assert.equal(sanitizeDescriptionHtml('<!-- <script>x</script> --><p>ok</p>'), '<p>ok</p>');
  const nested = sanitizeDescriptionHtml('<scr<script>ipt>alert(1)</script>');
  assert.doesNotMatch(nested, /<script/i);
  // Stray angle brackets become text, never markup.
  assert.equal(sanitizeDescriptionHtml('5 < 6 and 7 > 3'), '5 &lt; 6 and 7 &gt; 3');
  const attrGt = sanitizeDescriptionHtml('<p title="a>b" onmouseover=alert(1)>t</p>');
  // The leftover attribute text is inert, escaped text inside <p>.
  assert.equal(attrGt, '<p>b" onmouseover=alert(1)&gt;t</p>');
});

test('sanitizer output only contains canonical allowlisted tags (fuzz)', () => {
  const pieces = ['<p>', '</p>', '<img src=x onerror=1>', '<script>', '</script>', 'text', '<', '>', '"', "'", '<a href=x>', '<li class=a>', '<br/>', '<!--', '-->', '<svg>', '<b>', '&amp;'];
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let n = 0; n < 500; n++) {
    let s = '';
    for (let k = 0; k < 12; k++) s += pieces[Math.floor(rand() * pieces.length)];
    const out = sanitizeDescriptionHtml(s);
    for (const tag of out.match(/<[^>]*>?/g) ?? []) {
      assert.match(tag, /^<\/?(p|ul|ol|li|strong|em|b|i|br)>$/, `input ${JSON.stringify(s)} -> ${JSON.stringify(out)}`);
    }
  }
});

test('isEffectivelyEmptyHtml detects markup without visible text', () => {
  assert.equal(isEffectivelyEmptyHtml('<p></p><ul><li> </li></ul>'), true);
  assert.equal(isEffectivelyEmptyHtml('<p>&nbsp;</p>'), true);
  assert.equal(isEffectivelyEmptyHtml('<p>x</p>'), false);
});

// ---------------------------------------------------------------------------
// 2. Enhance route writes only sanitized HTML
// ---------------------------------------------------------------------------
test('description mode: malicious AI HTML is sanitized before productUpdate', async () => {
  geminiHandler = () => geminiText({ html: '<p>Nice</p><img src=x onerror="alert(1)"><script>steal()</script><ul><li onclick="x">A</li></ul>' });
  const res = await enhance(['gid://shopify/Product/1'], 'description');
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.results[0].success, true);
  assert.equal(updates().length, 1);
  assert.equal(updates()[0].variables.product.descriptionHtml, '<p>Nice</p><ul><li>A</li></ul>');
});

test('all mode: combined generator output is sanitized too', async () => {
  geminiHandler = () => geminiText({ title: 'New Title', html: '<p style="color:red">Desc</p><script>x()</script>', seoTitle: 'S', seoDescription: 'D', handle: 'h', tags: ['z'] });
  const res = await enhance(['gid://shopify/Product/1'], 'all');
  const body = await res.json();
  assert.equal(body.results[0].success, true);
  assert.equal(updates()[0].variables.product.descriptionHtml, '<p>Desc</p>');
});

test('description that is empty after sanitizing is not written (per-product failure, no usage)', async () => {
  geminiHandler = () => geminiText({ html: '<script>only()</script><p> </p>' });
  const res = await enhance(['gid://shopify/Product/1'], 'description');
  const body = await res.json();
  assert.equal(body.results[0].success, false);
  assert.equal(updates().length, 0);
  assert.deepEqual(usage, []);
});

// ---------------------------------------------------------------------------
// 3. Timeouts
// ---------------------------------------------------------------------------
test('every Gemini request carries an AbortSignal', async () => {
  geminiHandler = () => geminiText({ html: '<p>ok</p>' });
  await enhance(['gid://shopify/Product/1'], 'description');
  assert.ok(geminiSignals.length >= 1);
  for (const s of geminiSignals) assert.ok(s instanceof AbortSignal, 'Gemini fetch must have a signal');
});

test('a hung Gemini request is aborted and reported as a clean per-product failure', async () => {
  geminiHandler = hangUntilAborted;
  const started = Date.now();
  const res = await withFastTimeouts(30, () => enhance(['gid://shopify/Product/1'], 'title'));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.results[0].success, false);
  assert.equal(updates().length, 0);
  assert.deepEqual(usage, []);
  assert.ok(Date.now() - started < 5000, 'must not hang');
});

test('Abacus fallback request carries an AbortSignal and a hung fallback is aborted', async () => {
  process.env.ABACUS_API_KEY = 'fake-abacus-key';
  geminiHandler = () => new Response('quota', { status: 429 });
  abacusHandler = hangUntilAborted;
  const res = await withFastTimeouts(30, () => enhance(['gid://shopify/Product/1'], 'title'));
  const body = await res.json();
  assert.equal(body.results[0].success, false);
  assert.ok(abacusSignals.length >= 1);
  for (const s of abacusSignals) assert.ok(s instanceof AbortSignal, 'Abacus fetch must have a signal');
});

// ---------------------------------------------------------------------------
// 4. Bounded concurrency
// ---------------------------------------------------------------------------
test('enhance never runs more than 5 AI pipelines at once and processes every product', async () => {
  geminiHandler = async () => { await new Promise((r) => setTimeout(r, 15)); return geminiText({ html: '<p>ok</p>' }); };
  const ids = Array.from({ length: 25 }, (_, i) => `gid://shopify/Product/${i + 1}`);
  const res = await enhance(ids, 'description');
  const body = await res.json();
  assert.equal(body.results.length, 25);
  assert.ok(body.results.every((r: any) => r.success));
  assert.deepEqual(body.results.map((r: any) => r.id), ids, 'result order preserved');
  assert.ok(maxInflight <= 5, `max in-flight Gemini calls was ${maxInflight}`);
  assert.ok(maxInflight >= 2, 'still runs in parallel');
  assert.deepEqual(usage, [25]);
});

test('mapWithConcurrency preserves order, respects the limit and handles empty input', async () => {
  let live = 0;
  let peak = 0;
  const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0, 6], 3, async (v, i) => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, v * 3));
    live--;
    return `${i}:${v}`;
  });
  assert.deepEqual(out, ['0:5', '1:1', '2:4', '3:2', '4:3', '5:0', '6:6']);
  assert.ok(peak <= 3);
  assert.deepEqual(await mapWithConcurrency([], 5, async () => 1), []);
  assert.deepEqual(await mapWithConcurrency([1, 2], 0, async (v) => v * 2), [2, 4]);
});
