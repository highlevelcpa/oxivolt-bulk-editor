// Phase 2 bulk-edit safety tests: server-side validation and the Preview -> Apply binding
// for POST /api/products/preview, /update, /undo and /restore.
//
// MOCKED ONLY: `fetch` (Shopify Admin GraphQL) and Prisma (globalThis.prisma) are fakes.
// No real store is contacted and nothing real is modified. Every rejection test asserts
// that ZERO Shopify requests were made (not just zero mutations) and nothing was logged
// or counted as usage.
//
// Run: node --import tsx --test tests/*.test.ts
import { test, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const SHOP = 'test-shop.myshopify.com';
const OTHER_SHOP = 'other-shop.myshopify.com';
const ACCESS_TOKEN = 'fake-test-access-token-do-not-leak';
const LOCATION_ID = 'gid://shopify/Location/1';

process.env.SHOPIFY_API_KEY = API_KEY;
process.env.SHOPIFY_API_SECRET = API_SECRET;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
type Call = { url: string; query: string; variables: any };
let calls: Call[] = [];
let editLogs: any[] = [];
let usageIncrements: number[] = [];
let editLogRows: any[] = [];

const WRITE_OPS = ['productUpdate(', 'productVariantsBulkUpdate(', 'inventoryItemUpdate(', 'inventoryActivate(', 'inventorySetQuantities('];
const isWrite = (q: string) => WRITE_OPS.some((op) => q.includes(op));

function handle(query: string, vars: any): any {
  if (query.includes('shop { id }')) return { data: { shop: { id: 'gid://shopify/Shop/1' } } };
  if (query.includes('currentAppInstallation')) {
    return {
      data: {
        currentAppInstallation: {
          id: 'gid://shopify/AppInstallation/1',
          activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', name: 'Pro', status: 'ACTIVE', lineItems: [] }],
        },
      },
    };
  }
  if (query.includes('locations(')) return { data: { locations: { edges: [{ node: { id: LOCATION_ID } }] } } };
  if (query.includes('inventoryLevel(locationId')) {
    return {
      data: {
        inventoryItem: {
          id: vars?.inventoryItemId,
          inventoryLevel: { id: 'gid://shopify/InventoryLevel/1', quantities: [{ name: 'available', quantity: 7 }] },
        },
      },
    };
  }
  if (query.includes('inventoryLevels(first')) {
    return { data: { inventoryItem: { id: vars?.inventoryItemId, inventoryLevels: { edges: [{ node: { id: 'lvl0' } }] } } } };
  }
  if (query.includes('productUpdate(')) return { data: { productUpdate: { product: { id: vars?.product?.id }, userErrors: [] } } };
  if (query.includes('productVariantsBulkUpdate(')) {
    return { data: { productVariantsBulkUpdate: { productVariants: vars?.variants ?? [], userErrors: [] } } };
  }
  if (query.includes('inventoryItemUpdate(')) {
    return { data: { inventoryItemUpdate: { inventoryItem: { id: vars?.id, tracked: true }, userErrors: [] } } };
  }
  if (query.includes('inventoryActivate(')) {
    return { data: { inventoryActivate: { inventoryLevel: { id: 'gid://shopify/InventoryLevel/1' }, userErrors: [] } } };
  }
  if (query.includes('inventorySetQuantities(')) return { data: { inventorySetQuantities: { userErrors: [] } } };
  return { errors: [{ message: 'unexpected query in test' }] };
}

// Records every request (for any host) so "no Shopify call" assertions are exact.
const fetchMock = async (url: any, init: any) => {
  const body = JSON.parse(init?.body ?? '{}');
  calls.push({ url: String(url), query: body.query ?? '', variables: body.variables });
  return new Response(JSON.stringify(handle(body.query ?? '', body.variables)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const fakePrisma: any = {
  shopSession: {
    findUnique: async ({ where }: any) =>
      where?.shop === SHOP ? { shop: SHOP, accessToken: ACCESS_TOKEN, tokenExpiresAt: new Date(Date.now() + 3600_000) } : null,
    upsert: async () => ({}),
  },
  shopBilling: { findUnique: async () => null, upsert: async () => ({}) },
  editLog: {
    create: async ({ data }: any) => {
      editLogs.push(data);
      return data;
    },
    findFirst: async ({ where }: any) => editLogRows.find((r) => r.id === where.id && r.shop === where.shop) ?? null,
    findMany: async ({ where }: any) =>
      editLogRows.filter((r) => r.shop === where.shop && r.productId === where.productId && r.success && !r.undone),
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
  },
  usageCounter: {
    upsert: async ({ create }: any) => {
      usageIncrements.push(create.count);
      return {};
    },
  },
};
(globalThis as any).prisma = fakePrisma;

type Handler = (req: any) => Promise<Response>;
let updatePOST: Handler;
let previewPOST: Handler;
let undoPOST: Handler;
let restorePOST: Handler;
let NextRequestCtor: any;
let pt: typeof import('../lib/preview-token');

before(async () => {
  (globalThis as any).fetch = fetchMock;
  NextRequestCtor = (await import('next/server')).NextRequest;
  updatePOST = (await import('../app/api/products/update/route')).POST;
  previewPOST = (await import('../app/api/products/preview/route')).POST;
  undoPOST = (await import('../app/api/products/undo/route')).POST;
  restorePOST = (await import('../app/api/products/restore/route')).POST;
  pt = await import('../lib/preview-token');
});

beforeEach(() => {
  calls = [];
  editLogs = [];
  usageIncrements = [];
  editLogRows = [];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sessionToken(shop = SHOP) {
  return jwt.sign({ aud: API_KEY, dest: `https://${shop}` }, API_SECRET, { algorithm: 'HS256' });
}

function request(path: string, body: unknown, opts: { shop?: string; auth?: boolean; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.auth !== false) headers.authorization = `Bearer ${sessionToken(opts.shop)}`;
  const init: any = { method: 'POST', headers };
  if (opts.raw !== undefined) init.body = opts.raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequestCtor(`http://localhost${path}`, init);
}

async function call(h: Handler, path: string, body: unknown, opts: Parameters<typeof request>[2] = {}) {
  const res = await h(request(path, body, opts));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

const apply = (body: unknown, opts: Parameters<typeof request>[2] = {}) => call(updatePOST, '/api/products/update', body, opts);
const preview = (body: unknown, opts: Parameters<typeof request>[2] = {}) => call(previewPOST, '/api/products/preview', body, opts);
const undo = (body: unknown, opts: Parameters<typeof request>[2] = {}) => call(undoPOST, '/api/products/undo', body, opts);
const restore = (body: unknown, opts: Parameters<typeof request>[2] = {}) => call(restorePOST, '/api/products/restore', body, opts);

/** Apply with a correctly signed token for exactly these updates (isolates validation from the preview check). */
const applySigned = (updates: unknown[]) => apply({ updates, previewToken: pt.signPreviewToken(SHOP, updates).token });

function item(n: number, extra: Record<string, unknown> = {}) {
  return {
    productId: `gid://shopify/Product/${n}`,
    title: `Product ${n}`,
    variantId: `gid://shopify/ProductVariant/${n}`,
    inventoryItemId: `gid://shopify/InventoryItem/${n}`,
    ...extra,
  };
}

function assertNothingHappened(r: { text: string }) {
  assert.equal(calls.length, 0, `expected no Shopify request, got ${calls.length}`);
  assert.equal(editLogs.length, 0, 'no edit log may be written');
  assert.deepEqual(usageIncrements, [], 'no usage may be counted');
  assert.ok(!r.text.includes(ACCESS_TOKEN), 'access token must never be echoed');
  assert.ok(!r.text.includes(API_SECRET), 'app secret must never be echoed');
  assert.ok(!/\bat [\w.]+ \(|node:internal|\.ts:\d+/.test(r.text), 'no stack trace in the response');
}

// ---------------------------------------------------------------------------
// 1. Missing / malformed body
// ---------------------------------------------------------------------------
test('1. missing, non-JSON, empty and non-object bodies are rejected on every endpoint', async () => {
  const cases: Array<[string, unknown, string | undefined]> = [
    ['no body', undefined, undefined],
    ['non-JSON', undefined, '{not json'],
    ['empty object', {}, undefined],
    ['array', [], undefined],
    ['null', null, undefined],
    ['string', 'updates', undefined],
  ];
  for (const [label, body, raw] of cases) {
    for (const [name, fn] of [['update', apply], ['preview', preview]] as const) {
      const r = await fn(body, raw !== undefined ? { raw } : {});
      assert.equal(r.status, 400, `${name} / ${label}`);
      assert.equal(r.json.error, 'No updates provided', `${name} / ${label}`);
      assertNothingHappened(r);
    }
    for (const [name, fn, key] of [['undo', undo, 'editLogId'], ['restore', restore, 'productId']] as const) {
      const r = await fn(body, raw !== undefined ? { raw } : {});
      assert.equal(r.status, 400, `${name} / ${label}`);
      assert.equal(r.json.error, `Missing ${key}`, `${name} / ${label}`);
      assertNothingHappened(r);
    }
  }
  for (const body of [{ updates: [] }, { updates: null }, { updates: 'x' }, { updates: {} }]) {
    const r = await applySigned(body.updates as any);
    assert.equal(r.status, 400);
    assertNothingHappened(r);
    const p = await preview({ chunks: [body.updates] });
    assert.equal(p.status, 400);
    assertNothingHappened(p);
  }
});

// ---------------------------------------------------------------------------
// 2-5. Empty and negative price / quantity
// ---------------------------------------------------------------------------
test('2. an empty fixed price is rejected (never becomes 0.00 or a skipped success)', async () => {
  for (const price of ['', '   ']) {
    const r = await applySigned([item(1, { price })]);
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'no_valid_updates');
    assert.match(r.json.results[0].error, /^price: invalid price/);
    assertNothingHappened(r);
    const p = await preview({ chunks: [[item(1, { price })]] });
    assert.equal(p.status, 400);
    assert.match(p.json.error, /price: invalid price/);
    assertNothingHappened(p);
  }
});

test('3. an empty quantity is rejected (never becomes 0 or null/skipped)', async () => {
  for (const quantity of ['', '  ']) {
    const r = await applySigned([item(1, { quantity })]);
    assert.equal(r.status, 400);
    assert.equal(r.json.results[0].error, 'quantity: invalid quantity (must be a whole number)');
    assertNothingHappened(r);
    const p = await preview({ chunks: [[item(1, { quantity })]] });
    assert.equal(p.status, 400);
    assertNothingHappened(p);
  }
  // `null` / omitted means "not requested"; with nothing else requested the item is rejected.
  const r = await applySigned([item(1, { quantity: null })]);
  assert.equal(r.status, 400);
  assert.equal(r.json.results[0].error, 'No changes requested for this product');
  assertNothingHappened(r);
});

test('4. negative and malformed prices are rejected', async () => {
  for (const price of ['-1', '-0.01', -5, '1e3', '$10', '1,000', '19.999.1', '12.3456', 'abc', Number.NaN, Infinity, true, {}]) {
    const r = await applySigned([item(1, { price })]);
    assert.equal(r.status, 400, `price ${String(price)}`);
    assertNothingHappened(r);
  }
});

test('5. negative, fractional and out-of-range quantities are rejected', async () => {
  for (const quantity of [-1, '-1', 1.5, '1.5', '1e3', 1_000_000_001, Number.NaN, 'ten', true, []]) {
    const r = await applySigned([item(1, { quantity })]);
    assert.equal(r.status, 400, `quantity ${String(quantity)}`);
    assertNothingHappened(r);
  }
});

// ---------------------------------------------------------------------------
// 6. Invalid multiplier
// ---------------------------------------------------------------------------
// The multiplier is a client-side input only: the browser computes base x factor and the
// server receives the resulting absolute price. So the server (a) refuses any attempt to
// send a multiplier/factor field and (b) rejects the invalid prices a bad factor produces.
test('6. multiplier: factor fields are not accepted and bad-factor results are rejected', async () => {
  for (const extra of [{ factor: 0.7 }, { multiplier: -1 }, { priceMode: 'multiply' }]) {
    const r = await applySigned([item(1, { price: '10.00', ...extra })]);
    assert.equal(r.status, 400);
    assert.match(r.json.results[0].error, /^Unsupported field\(s\)/);
    assertNothingHappened(r);
  }
  const top = await apply({ updates: [item(1, { price: '10.00' })], multiplier: 0.7 });
  assert.equal(top.status, 400);
  assert.equal(top.json.code, 'unsupported_field');
  assertNothingHappened(top);
  // What a negative / NaN / huge factor would produce on the client.
  for (const price of ['-7.00', 'NaN', 'Infinity', '1e+21']) {
    const r = await applySigned([item(1, { price })]);
    assert.equal(r.status, 400, `price ${price}`);
    assertNothingHappened(r);
  }
});

// ---------------------------------------------------------------------------
// 7-8. Vendor and identifiers
// ---------------------------------------------------------------------------
test('7. missing, empty, non-text and oversized vendors are rejected', async () => {
  const cases: Array<[unknown, RegExp]> = [
    ['', /^vendor: cannot be empty$/],
    ['   ', /^vendor: cannot be empty$/],
    [42, /^vendor: must be text$/],
    [['OXIVOLT'], /^vendor: must be text$/],
    ['x'.repeat(256), /^vendor: must be at most 255 characters$/],
  ];
  for (const [vendor, re] of cases) {
    const r = await applySigned([item(1, { vendor })]);
    assert.equal(r.status, 400);
    assert.match(r.json.results[0].error, re);
    assertNothingHappened(r);
  }
  // Missing vendor with nothing else requested -> nothing to do -> rejected, not "success".
  const r = await applySigned([item(1)]);
  assert.equal(r.status, 400);
  assert.equal(r.json.results[0].error, 'No changes requested for this product');
  assertNothingHappened(r);
});

test('8. invalid product, variant and inventory item ids are rejected', async () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ productId: undefined, vendor: 'A' }, /^Missing product id$/],
    [{ productId: 123, vendor: 'A' }, /^Missing product id$/],
    [{ productId: '123', vendor: 'A' }, /^Invalid product id$/],
    [{ productId: 'gid://shopify/ProductVariant/1', vendor: 'A' }, /^Invalid product id$/],
    [{ productId: 'gid://shopify/Product/1 OR 1=1', vendor: 'A' }, /^Invalid product id$/],
    [{ variantId: 'gid://shopify/Product/1', price: '1.00' }, /^price: missing or invalid variant id/],
    [{ variantId: null, price: '1.00' }, /^price: missing or invalid variant id/],
    [{ variantId: 5, vendor: 'A' }, /^variantId: must be text$/],
    [{ inventoryItemId: 'gid://shopify/Product/1', quantity: 1 }, /^quantity: invalid inventory item id/],
    [{ inventoryItemId: null, quantity: 1 }, /^quantity: missing inventory item id/],
  ];
  for (const [extra, re] of cases) {
    const r = await applySigned([item(1, extra)]);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match(r.json.results[0].error, re);
    assertNothingHappened(r);
  }
  for (const [name, fn, body] of [
    ['undo', undo, { editLogId: '../../etc/passwd' }],
    ['undo', undo, { editLogId: 'x'.repeat(65) }],
    ['undo', undo, { editLogId: 42 }],
    ['restore', restore, { productId: '1' }],
    ['restore', restore, { productId: 'gid://shopify/ProductVariant/1' }],
  ] as const) {
    const r = await fn(body);
    assert.equal(r.status, 400, `${name} ${JSON.stringify(body)}`);
    assert.match(r.json.error, /^(Invalid|Missing) /);
    assertNothingHappened(r);
  }
});

// ---------------------------------------------------------------------------
// 9-10. Batch size and unsupported operations / fields
// ---------------------------------------------------------------------------
test('9. batches above the limits are rejected (51 updates; 21 preview chunks; duplicates)', async () => {
  const fiftyOne = Array.from({ length: 51 }, (_, i) => item(i + 1, { vendor: 'A' }));
  const r = await applySigned(fiftyOne);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'too_many_updates');
  assertNothingHappened(r);

  const p = await preview({ chunks: [fiftyOne] });
  assert.equal(p.status, 400);
  assert.equal(p.json.code, 'too_many_updates');
  assertNothingHappened(p);

  const chunks = Array.from({ length: 21 }, (_, i) => [item(i + 1, { vendor: 'A' })]);
  const p2 = await preview({ chunks });
  assert.equal(p2.status, 400);
  assert.equal(p2.json.code, 'too_many_updates');
  assertNothingHappened(p2);

  const dup = await applySigned([item(1, { vendor: 'A' }), item(1, { vendor: 'B' })]);
  assert.equal(dup.status, 400);
  assert.equal(dup.json.results[1].error, 'Duplicate product in this request');
  assertNothingHappened(dup);

  const crossChunkDup = await preview({ chunks: [[item(1, { vendor: 'A' })], [item(1, { vendor: 'B' })]] });
  assert.equal(crossChunkDup.status, 400);
  assert.match(crossChunkDup.json.error, /Duplicate product/);
  assertNothingHappened(crossChunkDup);
});

test('10. unsupported operations and unexpected fields are rejected, not silently dropped', async () => {
  for (const extra of [{ operation: 'delete' }, { compareAtPrice: '9.99' }, { title_new: 'x' }, { __proto__x: 1 }]) {
    const r = await applySigned([item(1, { vendor: 'A', ...extra })]);
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.match(r.json.results[0].error, /^Unsupported field\(s\)/);
    assertNothingHappened(r);
  }
  for (const body of [
    { updates: [item(1, { vendor: 'A' })], operation: 'delete' },
    { updates: [item(1, { vendor: 'A' })], dryRun: false },
  ]) {
    const r = await apply(body);
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'unsupported_field');
    assertNothingHappened(r);
  }
  const p = await preview({ chunks: [[item(1, { vendor: 'A' })]], force: true });
  assert.equal(p.status, 400);
  assert.equal(p.json.code, 'unsupported_field');
  assertNothingHappened(p);
  const st = await applySigned([item(1, { status: 'DELETED' })]);
  assert.equal(st.status, 400);
  assertNothingHappened(st);
  for (const [fn, body] of [
    [undo, { editLogId: 'abc', force: true }],
    [restore, { productId: 'gid://shopify/Product/1', all: true }],
    [undo, { editLogId: 'abc', acceptCurrentQuantity: 1.5 }],
    [undo, { editLogId: 'abc', acceptCurrentQuantity: '5' }],
    [restore, { productId: 'gid://shopify/Product/1', acceptCurrentQuantity: 2e9 }],
  ] as const) {
    const r = await fn(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assertNothingHappened(r);
  }
});

// ---------------------------------------------------------------------------
// 11-13. Preview -> Apply binding
// ---------------------------------------------------------------------------
test('11. Apply without a preview token is refused (428) with no Shopify call', async () => {
  for (const previewToken of [undefined, null, '']) {
    const body: any = { updates: [item(1, { vendor: 'A' })] };
    if (previewToken !== undefined) body.previewToken = previewToken;
    const r = await apply(body);
    assert.equal(r.status, 428);
    assert.equal(r.json.code, 'preview_required');
    assertNothingHappened(r);
  }
  for (const previewToken of ['garbage', 'a.b', 'a.b.c', 42, { t: 1 }, 'x'.repeat(5000)]) {
    const r = await apply({ updates: [item(1, { vendor: 'A' })], previewToken });
    assert.equal(r.status, 400, String(previewToken).slice(0, 20));
    assert.equal(r.json.code, 'preview_invalid');
    assertNothingHappened(r);
  }
});

test('12. Apply with data that differs from the preview is refused (409 preview_mismatch)', async () => {
  const previewed = [item(1, { price: '10.00' }), item(2, { price: '20.00' })];
  const { token } = pt.signPreviewToken(SHOP, previewed);
  const variants: Array<[string, unknown[]]> = [
    ['price changed', [item(1, { price: '1.00' }), item(2, { price: '20.00' })]],
    ['product added', [...previewed, item(3, { price: '30.00' })]],
    ['product removed', [previewed[0]]],
    ['order changed', [previewed[1], previewed[0]]],
    ['field added', [item(1, { price: '10.00', vendor: 'X' }), item(2, { price: '20.00' })]],
    ['equivalent but differently formatted price', [item(1, { price: '10' }), item(2, { price: '20.00' })]],
  ];
  for (const [label, updates] of variants) {
    const r = await apply({ updates, previewToken: token });
    assert.equal(r.status, 409, label);
    assert.equal(r.json.code, 'preview_mismatch', label);
    assertNothingHappened(r);
  }
  // Tampering with the token itself (payload or signature) is caught by the HMAC.
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), h: pt.hashUpdates(variants[0][1]) }),
  ).toString('base64url');
  for (const bad of [`${forged}.${sig}`, `${payload}.${sig.slice(0, -2)}AA`]) {
    const r = await apply({ updates: variants[0][1], previewToken: bad });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'preview_invalid');
    assertNothingHappened(r);
  }
  // Key order inside an item does not matter (canonical JSON), values do.
  assert.equal(pt.hashUpdates([{ a: 1, b: 2 }]), pt.hashUpdates([{ b: 2, a: 1 }]));
  assert.notEqual(pt.hashUpdates([{ a: 1 }]), pt.hashUpdates([{ a: '1' }]));
});

test('13. Apply with a stale (expired) or future-dated preview is refused', async () => {
  const updates = [item(1, { vendor: 'A' })];
  const stale = pt.signPreviewToken(SHOP, updates, Date.now() - pt.PREVIEW_TTL_MS - 1000).token;
  const r = await apply({ updates, previewToken: stale });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'preview_expired');
  assertNothingHappened(r);

  const future = pt.signPreviewToken(SHOP, updates, Date.now() + 5 * 60_000).token;
  const f = await apply({ updates, previewToken: future });
  assert.equal(f.status, 400);
  assert.equal(f.json.code, 'preview_invalid');
  assertNothingHappened(f);

  // Unit-level boundary check (pure function).
  const t0 = 1_800_000_000_000;
  const tok = pt.signPreviewToken(SHOP, updates, t0).token;
  assert.equal(pt.verifyPreviewToken(tok, SHOP, updates, t0 + pt.PREVIEW_TTL_MS).ok, true);
  assert.equal((pt.verifyPreviewToken(tok, SHOP, updates, t0 + pt.PREVIEW_TTL_MS + 1) as any).code, 'preview_expired');
});

// ---------------------------------------------------------------------------
// 14. Unauthorized shop access
// ---------------------------------------------------------------------------
test('14. unauthenticated requests and other-shop previews / edits are refused', async () => {
  const updates = [item(1, { vendor: 'A' })];
  for (const fn of [apply, preview, undo, restore]) {
    const r = await fn({ updates }, { auth: false });
    assert.equal(r.status, 401);
    assertNothingHappened(r);
  }
  // Session token signed with the wrong secret.
  const forgedSession = jwt.sign({ aud: API_KEY, dest: `https://${SHOP}` }, 'wrong-secret', { algorithm: 'HS256' });
  const res = await updatePOST(
    new NextRequestCtor('http://localhost/api/products/update', {
      method: 'POST',
      headers: { authorization: `Bearer ${forgedSession}`, 'content-type': 'application/json' },
      body: JSON.stringify({ updates, previewToken: pt.signPreviewToken(SHOP, updates).token }),
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);

  // A preview issued to another store cannot be applied here, in either direction.
  const otherToken = pt.signPreviewToken(OTHER_SHOP, updates).token;
  const a = await apply({ updates, previewToken: otherToken });
  assert.equal(a.status, 403);
  assert.equal(a.json.code, 'preview_shop_mismatch');
  assertNothingHappened(a);
  const ourToken = pt.signPreviewToken(SHOP, updates).token;
  const b = await apply({ updates, previewToken: ourToken }, { shop: OTHER_SHOP });
  assert.equal(b.status, 403);
  assert.equal(b.json.code, 'preview_shop_mismatch');
  assertNothingHappened(b);

  // Undo / Restore of another store's edit history is not found (queries are shop-scoped).
  editLogRows = [
    {
      id: 'clotherlog0001',
      shop: OTHER_SHOP,
      productId: 'gid://shopify/Product/1',
      success: true,
      undone: false,
      previousValues: JSON.stringify({ vendor: 'Old' }),
      changes: JSON.stringify({ vendor: 'A' }),
      createdAt: new Date(),
    },
  ];
  const u = await undo({ editLogId: 'clotherlog0001' });
  assert.equal(u.status, 404);
  assertNothingHappened(u);
  const rs = await restore({ productId: 'gid://shopify/Product/1' });
  assert.ok(rs.status >= 400 && rs.status < 500, `restore status ${rs.status}`);
  assertNothingHappened(rs);
});

// ---------------------------------------------------------------------------
// 15. Valid flow: preview endpoint -> apply with its token
// ---------------------------------------------------------------------------
test('15. a valid request: preview issues a token with no side effects, apply writes exactly the preview', async () => {
  const updates = [
    item(1, { vendor: ' Acme ', prevVendor: 'Old' }),
    item(2, { price: '19.99', prevPrice: '25.00' }),
    item(3, { quantity: '12', prevQuantity: 7 }),
  ];
  const p = await preview({ chunks: [updates] });
  assert.equal(p.status, 200);
  assert.equal(p.json.chunks.length, 1);
  assert.equal(p.json.chunks[0].count, 3);
  assert.equal(typeof p.json.chunks[0].previewToken, 'string');
  assert.ok(p.json.expiresAt > Date.now());
  assertNothingHappened(p); // preview: no Shopify call, no log, no usage

  const r = await apply({ updates, previewToken: p.json.chunks[0].previewToken });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(
    r.json.results.map((x: any) => [x.productId, x.success, x.error]),
    [
      ['gid://shopify/Product/1', true, null],
      ['gid://shopify/Product/2', true, null],
      ['gid://shopify/Product/3', true, null],
    ],
  );
  const writes = calls.filter((c) => isWrite(c.query));
  const vendorWrite = writes.find((c) => c.query.includes('productUpdate('));
  assert.deepEqual(vendorWrite?.variables, { product: { id: 'gid://shopify/Product/1', vendor: 'Acme' } });
  const priceWrite = writes.find((c) => c.query.includes('productVariantsBulkUpdate('));
  assert.deepEqual(priceWrite?.variables, {
    productId: 'gid://shopify/Product/2',
    variants: [{ id: 'gid://shopify/ProductVariant/2', price: '19.99' }],
  });
  const qtyWrite = writes.find((c) => c.query.includes('inventorySetQuantities('));
  assert.equal(qtyWrite?.variables.input.quantities[0].quantity, 12);
  // One value write per requested change, plus the route's pre-existing inventory setup
  // (inventoryItemUpdate tracked:true + inventoryActivate) for the quantity item only.
  assert.equal(writes.length, 5);
  const setup = writes.filter((c) => c.query.includes('inventoryItemUpdate(') || c.query.includes('inventoryActivate('));
  assert.equal(setup.length, 2);
  assert.ok(setup.every((c) => JSON.stringify(c.variables).includes('gid://shopify/InventoryItem/3')));
  assert.ok(!writes.some((c) => /Product\/[4-9]|InventoryItem\/[12]\b/.test(JSON.stringify(c.variables))));
  assert.ok(calls.every((c) => c.url.startsWith(`https://${SHOP}/`)), 'only this shop is contacted');
  assert.equal(editLogs.length, 3);
  assert.deepEqual(usageIncrements, [3]);

  // Several preview chunks each get their own token, bound to their own batch.
  const p2 = await preview({ chunks: [[item(4, { vendor: 'B' })], [item(5, { vendor: 'C' })]] });
  assert.equal(p2.status, 200);
  calls = [];
  const wrong = await apply({ updates: [item(5, { vendor: 'C' })], previewToken: p2.json.chunks[0].previewToken });
  assert.equal(wrong.status, 409);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// 16. Multiple validation failures in one request
// ---------------------------------------------------------------------------
test('16. multiple failures in one request: every item error is reported, nothing is applied', async () => {
  const updates = [
    item(1, { vendor: 'Valid' }),
    item(2, { price: '' }),
    item(3, { quantity: -4 }),
    item(4, { vendor: '' }),
    { productId: 'bad', vendor: 'A' },
    item(6, { vendor: 'A', operation: 'delete' }),
  ];
  const r = await applySigned(updates);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'invalid_updates');
  assert.match(r.json.error, /^5 of 6 updates are invalid; nothing was changed\./);
  assert.deepEqual(
    r.json.results.map((x: any) => [x.success, x.error && x.error.split(':')[0]]),
    [
      [false, null],
      [false, 'price'],
      [false, 'quantity'],
      [false, 'vendor'],
      [false, 'Invalid product id'],
      [false, 'Unsupported field(s)'],
    ],
  );
  assertNothingHappened(r);

  const p = await preview({ chunks: [updates.slice(0, 3), updates.slice(3)] });
  assert.equal(p.status, 400);
  assert.equal(p.json.chunks.length, 2);
  assert.equal(p.json.chunks[0].ok, false);
  assert.equal(p.json.chunks[0].results.length, 3);
  assert.equal(p.json.chunks[1].results.length, 3);
  assert.ok(!('previewToken' in p.json), 'no token is issued for an invalid preview');
  assertNothingHappened(p);
});
