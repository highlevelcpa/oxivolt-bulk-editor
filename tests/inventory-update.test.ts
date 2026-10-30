// Focused tests for the inventory quantity update flow (POST /api/products/update,
// plus the inventory step of /undo and /restore).
//
// Everything external is mocked: `fetch` (Shopify Admin GraphQL) and the Prisma
// client (injected via globalThis.prisma, which lib/db.ts reuses). No real store
// is contacted and no real inventory is modified.
//
// Run: node --import tsx --test tests/*.test.ts
import { test, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const SHOP = 'test-shop.myshopify.com';
const ACCESS_TOKEN = 'fake-test-access-token-do-not-leak';
const LOCATION_ID = 'gid://shopify/Location/1';

process.env.SHOPIFY_API_KEY = API_KEY;
process.env.SHOPIFY_API_SECRET = API_SECRET;

// ---------------------------------------------------------------------------
// Shopify Admin API 2026-04+ rules for inventorySetQuantities.
// API_VERSION explicitly targets 2026-04, so these are the rules Shopify enforces:
//   - `ignoreCompareQuantity` / `compareQuantity` removed (deprecated in 2026-01)
//   - every quantity must include `changeFromQuantity` (null = skip the CAS check; a number = CAS guard)
//   - `@idempotent(key:)` directive required (optional in 2026-01)
// ---------------------------------------------------------------------------
const SET_INPUT_FIELDS_2026_04 = ['name', 'reason', 'referenceDocumentUri', 'quantities'];
const QTY_INPUT_FIELDS_2026_04 = ['inventoryItemId', 'locationId', 'quantity', 'changeFromQuantity'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Mirrors the top-level GraphQL errors Shopify returns for invalid input fields.
function validateSetInput2026_04(input: any): any[] | null {
  for (const k of Object.keys(input ?? {})) {
    if (!SET_INPUT_FIELDS_2026_04.includes(k)) {
      return [{ message: `Variable $input of type InventorySetQuantitiesInput! was provided invalid value for ${k} (Field is not defined on InventorySetQuantitiesInput)` }];
    }
  }
  const quantities = Array.isArray(input?.quantities) ? input.quantities : [];
  for (let i = 0; i < quantities.length; i++) {
    for (const k of Object.keys(quantities[i] ?? {})) {
      if (!QTY_INPUT_FIELDS_2026_04.includes(k)) {
        return [{ message: `Variable $input of type InventorySetQuantitiesInput! was provided invalid value for quantities.${i}.${k} (Field is not defined on InventoryQuantityInput)` }];
      }
    }
    for (const req of ['inventoryItemId', 'locationId', 'quantity']) {
      if (quantities[i]?.[req] === undefined || quantities[i]?.[req] === null) {
        return [{ message: `Variable $input of type InventorySetQuantitiesInput! was provided invalid value for quantities.${i}.${req} (Expected value to not be null)` }];
      }
    }
    if (!('changeFromQuantity' in (quantities[i] ?? {}))) {
      return [{ message: `quantities.${i}.changeFromQuantity must be provided (pass null to skip the compare-and-swap check)` }];
    }
  }
  return null;
}

// 2026-04: the mutation must carry @idempotent(key:) with a non-empty key.
function validateIdempotency(query: string, vars: any): any[] | null {
  if (!/inventorySetQuantities\(input: \$input\)\s*@idempotent\(key: \$idempotencyKey\)/.test(query)) {
    return [{ message: 'The @idempotent directive is required for this mutation.' }];
  }
  if (typeof vars?.idempotencyKey !== 'string' || !vars.idempotencyKey) {
    return [{ message: 'Variable $idempotencyKey of type String! was provided invalid value' }];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
type Call = { query: string; variables: any; headers: Record<string, string> };
let calls: Call[] = [];
let overrides: Record<string, (vars: any) => any> = {};
let editLogs: any[] = [];
let usageIncrements: number[] = [];
let editLogRows: any[] = [];
let locationsResponse: any = { locations: { edges: [{ node: { id: LOCATION_ID } }] } };
// Simulated Shopify `available` quantity per inventory item at LOCATION_ID (default 7).
let levels: Record<string, number> = {};
// Number of locations each inventory item is stocked at (default 1 = single-location store).
let stockedLocations: Record<string, number> = {};
const levelOf = (id: string) => (id in levels ? levels[id] : 7);

function opName(query: string): string {
  if (query.includes('shop { id }')) return 'probe';
  if (query.includes('currentAppInstallation')) return 'billing';
  if (query.includes('locations(')) return 'locations';
  if (query.includes('inventoryLevel(locationId')) return 'invLevel';
  if (query.includes('inventoryLevels(first')) return 'invLevelCount';
  if (query.includes('productUpdate(')) return 'productUpdate';
  if (query.includes('productVariantsBulkUpdate(')) return 'variantPrice';
  if (query.includes('inventoryItemUpdate(')) return 'invItemUpdate';
  if (query.includes('inventoryActivate(')) return 'invActivate';
  if (query.includes('inventorySetQuantities(')) return 'invSet';
  return 'unknown';
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function defaultHandler(op: string, vars: any, query = ''): any {
  switch (op) {
    case 'probe':
      return { data: { shop: { id: 'gid://shopify/Shop/1' } } };
    case 'billing':
      return {
        data: {
          currentAppInstallation: {
            id: 'gid://shopify/AppInstallation/1',
            activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', name: 'Pro', status: 'ACTIVE', lineItems: [] }],
          },
        },
      };
    case 'locations':
      return { data: locationsResponse };
    case 'productUpdate':
      return { data: { productUpdate: { product: { id: vars?.product?.id }, userErrors: [] } } };
    case 'variantPrice':
      return { data: { productVariantsBulkUpdate: { productVariants: vars?.variants ?? [], userErrors: [] } } };
    case 'invItemUpdate':
      return { data: { inventoryItemUpdate: { inventoryItem: { id: vars?.id, tracked: true }, userErrors: [] } } };
    case 'invActivate':
      return { data: { inventoryActivate: { inventoryLevel: { id: 'gid://shopify/InventoryLevel/1' }, userErrors: [] } } };
    case 'invLevel':
      return {
        data: {
          inventoryItem: {
            id: vars?.inventoryItemId,
            inventoryLevel: { id: 'gid://shopify/InventoryLevel/1', quantities: [{ name: 'available', quantity: levelOf(vars?.inventoryItemId) }] },
          },
        },
      };
    case 'invLevelCount': {
      const n = stockedLocations[vars?.inventoryItemId] ?? 1;
      return { data: { inventoryItem: { id: vars?.inventoryItemId, inventoryLevels: { edges: Array.from({ length: Math.min(n, 2) }, (_, i) => ({ node: { id: `lvl${i}` } })) } } } };
    }
    case 'invSet': {
      const errors = validateIdempotency(query, vars) ?? validateSetInput2026_04(vars?.input);
      if (errors) return { errors };
      // Shopify compare-and-swap semantics.
      for (const q of vars.input.quantities) {
        if (q.changeFromQuantity !== null && q.changeFromQuantity !== levelOf(q.inventoryItemId)) {
          return { data: { inventorySetQuantities: { userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE', field: ['input', 'quantities', '0', 'changeFromQuantity'], message: 'The quantity has changed since it was last read.' }] } } };
        }
      }
      for (const q of vars.input.quantities) levels[q.inventoryItemId] = q.quantity;
      return { data: { inventorySetQuantities: { userErrors: [] } } };
    }
    default:
      return { errors: [{ message: 'unexpected query in test' }] };
  }
}

const fetchMock = async (url: any, init: any) => {
  const href = String(url);
  assert.ok(href.startsWith(`https://${SHOP}/admin/api/2026-04/graphql.json`), `unexpected fetch ${href}`);
  const body = JSON.parse(init?.body ?? '{}');
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const op = opName(body.query);
  calls.push({ query: body.query, variables: body.variables, headers });
  const handler = overrides[op];
  const result = handler ? handler(body.variables) : defaultHandler(op, body.variables, body.query);
  if (result instanceof Response) return result;
  return jsonResponse(result);
};

const fakePrisma: any = {
  shopSession: {
    findUnique: async () => ({ shop: SHOP, accessToken: ACCESS_TOKEN, tokenExpiresAt: new Date(Date.now() + 3600_000) }),
    upsert: async () => ({}),
  },
  shopBilling: { findUnique: async () => null, upsert: async () => ({}) },
  editLog: {
    create: async ({ data }: any) => {
      editLogs.push(data);
      return data;
    },
    findFirst: async ({ where }: any) => editLogRows.find((r) => r.id === where.id && r.shop === where.shop) ?? null,
    findMany: async () => editLogRows,
    update: async () => ({}),
    updateMany: async () => ({ count: editLogRows.length }),
  },
  usageCounter: {
    upsert: async ({ create }: any) => {
      usageIncrements.push(create.count);
      return {};
    },
  },
};
(globalThis as any).prisma = fakePrisma;

let updatePOST: (req: any) => Promise<Response>;
let undoPOST: (req: any) => Promise<Response>;
let restorePOST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
let signPreview: (shop: string, updates: unknown) => { token: string };

before(async () => {
  (globalThis as any).fetch = fetchMock;
  NextRequestCtor = (await import('next/server')).NextRequest;
  updatePOST = (await import('../app/api/products/update/route')).POST;
  undoPOST = (await import('../app/api/products/undo/route')).POST;
  restorePOST = (await import('../app/api/products/restore/route')).POST;
  signPreview = (await import('../lib/preview-token')).signPreviewToken;
});

beforeEach(() => {
  calls = [];
  overrides = {};
  editLogs = [];
  usageIncrements = [];
  editLogRows = [];
  locationsResponse = { locations: { edges: [{ node: { id: LOCATION_ID } }] } };
  levels = {};
  stockedLocations = {};
});

function sessionToken() {
  return jwt.sign({ aud: API_KEY, dest: `https://${SHOP}` }, API_SECRET, { algorithm: 'HS256' });
}

function request(path: string, body: any) {
  return new NextRequestCtor(`http://localhost${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Apply requires a server-issued preview token for the exact `updates` (lib/preview-token.ts).
// These flow tests sign one directly; tests/bulk-edit-safety.test.ts covers the
// preview endpoint and every rejection path of the token check.
async function postUpdate(updates: any[]) {
  const previewToken = signPreview(SHOP, updates).token;
  const res = await updatePOST(request('/api/products/update', { updates, previewToken }));
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

const callsOf = (op: string) => calls.filter((c) => opName(c.query) === op);

function product(n: number, extra: Record<string, any> = {}) {
  return {
    productId: `gid://shopify/Product/${n}`,
    title: `Product ${n}`,
    variantId: `gid://shopify/ProductVariant/${n}`,
    inventoryItemId: `gid://shopify/InventoryItem/${n}`,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// 1. Valid absolute update
// ---------------------------------------------------------------------------
test('sets an absolute available quantity with a 2026-01/2026-04-valid payload', async () => {
  const { status, json } = await postUpdate([product(1, { quantity: 200, prevQuantity: 7 })]);
  assert.equal(status, 200);
  assert.deepEqual(json.results, [
    { productId: 'gid://shopify/Product/1', success: true, error: null, changes: { quantity: 200 } },
  ]);

  const sets = callsOf('invSet');
  assert.equal(sets.length, 1);
  const { idempotencyKey, ...rest } = sets[0].variables;
  assert.deepEqual(rest, {
    input: {
      name: 'available',
      reason: 'correction',
      quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantity: 200, changeFromQuantity: 7 }],
    },
  });
  assert.match(idempotencyKey, UUID_RE);
  assert.match(sets[0].query, /inventorySetQuantities\(input: \$input\) @idempotent\(key: \$idempotencyKey\)/);
  assert.equal(validateSetInput2026_04(sets[0].variables.input), null);
  assert.equal(validateIdempotency(sets[0].query, sets[0].variables), null);
  assert.ok(!JSON.stringify(sets[0]).includes('ignoreCompareQuantity'));
  assert.ok(!JSON.stringify(sets[0]).includes('compareQuantity'));

  // Undo data preserved.
  assert.equal(editLogs.length, 1);
  assert.equal(editLogs[0].success, true);
  assert.deepEqual(JSON.parse(editLogs[0].previousValues), {
    quantity: 7,
    inventoryItemId: 'gid://shopify/InventoryItem/1',
    locationId: LOCATION_ID,
    quantityScope: 'location',
  });
  assert.deepEqual(usageIncrements, [1]);
});

test('accepts zero and numeric-string quantities as absolute values', async () => {
  const { json } = await postUpdate([product(1, { quantity: 0 }), product(2, { quantity: '15' })]);
  assert.ok(json.results.every((r: any) => r.success));
  assert.deepEqual(
    callsOf('invSet').map((c) => c.variables.input.quantities[0].quantity),
    [0, 15],
  );
});

// ---------------------------------------------------------------------------
// 2 + 3. Multiple products, correct inventory item and location IDs
// ---------------------------------------------------------------------------
test('updates multiple selected products, each with its own inventory item at the primary location', async () => {
  const { json } = await postUpdate([1, 2, 3].map((n) => product(n, { quantity: 200 })));
  assert.equal(json.results.length, 3);
  assert.ok(json.results.every((r: any) => r.success === true));

  // Location resolved exactly once for the whole batch.
  assert.equal(callsOf('locations').length, 1);

  const sets = callsOf('invSet');
  assert.equal(sets.length, 3);
  sets.forEach((c, i) => {
    const q = c.variables.input.quantities;
    assert.equal(q.length, 1);
    assert.equal(q[0].inventoryItemId, `gid://shopify/InventoryItem/${i + 1}`);
    assert.equal(q[0].locationId, LOCATION_ID);
    assert.equal(q[0].quantity, 200);
  });
  // Tracking + activation happen per item, before the set, with the same IDs.
  assert.deepEqual(callsOf('invItemUpdate').map((c) => c.variables), [1, 2, 3].map((n) => ({ id: `gid://shopify/InventoryItem/${n}`, input: { tracked: true } })));
  assert.deepEqual(
    callsOf('invActivate').map((c) => ({ ...c.variables, idempotencyKey: typeof c.variables.idempotencyKey })),
    [1, 2, 3].map((n) => ({ inventoryItemId: `gid://shopify/InventoryItem/${n}`, locationId: LOCATION_ID, idempotencyKey: 'string' })),
  );
  assert.deepEqual(usageIncrements, [3]);
});

test('one failing product does not mark the others as failed (and vice versa)', async () => {
  overrides.invSet = (vars) => {
    const id = vars.input.quantities[0].inventoryItemId;
    if (id.endsWith('/2')) {
      return { data: { inventorySetQuantities: { userErrors: [{ field: ['input'], message: 'Inventory item not found' }] } } };
    }
    return { data: { inventorySetQuantities: { userErrors: [] } } };
  };
  const { json } = await postUpdate([1, 2, 3].map((n) => product(n, { quantity: 5 })));
  assert.deepEqual(json.results.map((r: any) => r.success), [true, false, true]);
  assert.equal(json.results[1].error, 'quantity: Inventory item not found');
  assert.deepEqual(usageIncrements, [2]);
});

// ---------------------------------------------------------------------------
// 4. Tracking disabled / unsupported inventory states
// ---------------------------------------------------------------------------
test('untracked items are switched to tracked and activated before the quantity is set', async () => {
  await postUpdate([product(1, { quantity: 10 })]);
  const order = calls.map((c) => opName(c.query)).filter((o) => o.startsWith('inv'));
  assert.deepEqual(order, ['invItemUpdate', 'invActivate', 'invLevel', 'invSet']);
});

test('unsupported inventory state rejected by Shopify is reported as a failure, not success', async () => {
  overrides.invItemUpdate = () => ({
    data: { inventoryItemUpdate: { inventoryItem: null, userErrors: [{ field: ['tracked'], message: 'Tracking is not supported' }] } },
  });
  overrides.invSet = () => ({
    data: { inventorySetQuantities: { userErrors: [{ field: ['input', 'quantities', '0', 'locationId'], message: 'The specified inventory item is not stocked at the location.' }] } },
  });
  const { json } = await postUpdate([product(1, { quantity: 10 })]);
  assert.equal(json.results[0].success, false);
  assert.match(json.results[0].error, /not stocked at the location/);
  assert.equal(editLogs[0].success, false);
  assert.deepEqual(usageIncrements, []);
});

test('no active location: quantity fails with a clear error and no inventory mutation is sent', async () => {
  locationsResponse = { locations: { edges: [] } };
  const { json } = await postUpdate([product(1, { quantity: 10 })]);
  assert.equal(json.results[0].success, false);
  assert.equal(json.results[0].error, 'quantity: no active store location found');
  assert.equal(callsOf('invSet').length, 0);
});

// ---------------------------------------------------------------------------
// 5. Shopify user errors, GraphQL errors and network failures
// ---------------------------------------------------------------------------
test('inventorySetQuantities userErrors surface as a failed result', async () => {
  overrides.invSet = () => ({
    data: { inventorySetQuantities: { userErrors: [{ field: ['input', 'reason'], message: 'Reason is invalid' }, { field: null, message: 'Second' }] } },
  });
  const { json } = await postUpdate([product(1, { quantity: 10 })]);
  assert.deepEqual(json.results[0], { productId: 'gid://shopify/Product/1', success: false, error: 'quantity: Reason is invalid; Second', changes: {} });
});

test('top-level GraphQL errors surface as a failed result', async () => {
  overrides.invSet = () => ({ errors: [{ message: 'Throttled' }] });
  const { json } = await postUpdate([product(1, { quantity: 10 })]);
  assert.equal(json.results[0].success, false);
  assert.match(json.results[0].error, /^quantity: Shopify GraphQL error: .*Throttled/);
});

test('network failure and HTTP 5xx are reported per product without leaking the access token', async () => {
  let n = 0;
  overrides.invSet = () => {
    n += 1;
    if (n === 1) throw new TypeError('fetch failed');
    return new Response('Internal Server Error', { status: 500 });
  };
  const { json, text } = await postUpdate([product(1, { quantity: 10 }), product(2, { quantity: 10 })]);
  assert.deepEqual(json.results.map((r: any) => r.success), [false, false]);
  assert.equal(json.results[0].error, 'quantity: network error contacting Shopify');
  // HTTP status only; the raw Shopify response body is not echoed to the browser.
  assert.equal(json.results[1].error, 'quantity: Shopify API error 500');
  assert.ok(!text.includes('Internal Server Error'));
  assert.ok(!text.includes(ACCESS_TOKEN));
  assert.ok(!JSON.stringify(editLogs).includes(ACCESS_TOKEN));
  assert.deepEqual(usageIncrements, []);
});

test('access token is only sent in the X-Shopify-Access-Token header, never in variables', async () => {
  await postUpdate([product(1, { quantity: 10 })]);
  for (const c of calls) {
    assert.equal(c.headers['X-Shopify-Access-Token'], ACCESS_TOKEN);
    assert.ok(!JSON.stringify(c.variables).includes(ACCESS_TOKEN));
  }
});

// ---------------------------------------------------------------------------
// 6. Invalid quantities and missing identifiers
// ---------------------------------------------------------------------------
for (const bad of ['abc', 1.5, '12.7', {}]) {
  test(`rejects invalid quantity ${JSON.stringify(bad)} without calling Shopify inventory APIs`, async () => {
    const { json } = await postUpdate([product(1, { quantity: bad })]);
    assert.equal(json.results[0].success, false);
    assert.equal(json.results[0].error, 'quantity: invalid quantity (must be a whole number)');
    assert.equal(callsOf('invSet').length, 0);
    assert.equal(callsOf('invItemUpdate').length, 0);
  });
}

test('missing inventory item id rejects the whole request (all-or-nothing), nothing is written', async () => {
  const { status, json } = await postUpdate([product(1, { quantity: 3, inventoryItemId: null }), product(2, { quantity: 3 })]);
  assert.equal(status, 400);
  assert.equal(json.code, 'invalid_updates');
  assert.equal(json.results[0].success, false);
  assert.equal(json.results[0].error, 'quantity: missing inventory item id for this product');
  assert.equal(json.results[1].success, false);
  assert.equal(json.results[1].error, null);
  assert.equal(calls.length, 0);
});

test('missing product id and empty update list are rejected', async () => {
  const { json } = await postUpdate([{ quantity: 3, inventoryItemId: 'gid://shopify/InventoryItem/1' }]);
  assert.deepEqual(json.results[0], { productId: '', success: false, error: 'Missing product id' });
  assert.equal(callsOf('invSet').length, 0);

  const empty = await postUpdate([]);
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error, 'No updates provided');
});

test('quantity omitted (null) does not trigger any inventory call', async () => {
  await postUpdate([product(1, { quantity: null, vendor: 'ACME' })]);
  assert.equal(callsOf('locations').length, 0);
  assert.equal(callsOf('invSet').length, 0);
});

// ---------------------------------------------------------------------------
// 7. Compare-and-set handling
// ---------------------------------------------------------------------------
test('CAS guard is the server-read location quantity, never the client prevQuantity or deprecated fields', async () => {
  levels['gid://shopify/InventoryItem/1'] = 4;
  await postUpdate([product(1, { quantity: 200, prevQuantity: 999 })]);
  const input = callsOf('invSet')[0].variables.input;
  assert.ok(!('ignoreCompareQuantity' in input));
  for (const q of input.quantities) {
    assert.equal(q.changeFromQuantity, 4); // read from Shopify, not the client-side 999
    assert.ok(!('compareQuantity' in q));
  }
  // The Undo snapshot is the value actually overwritten at this location, marked as such.
  assert.equal(JSON.parse(editLogs[0].previousValues).quantity, 4);
  assert.equal(JSON.parse(editLogs[0].previousValues).quantityScope, 'location');
});

test('a sale between read and write (CAS stale) is reported and no Undo snapshot is stored', async () => {
  overrides.invLevel = (vars) => {
    const r = { data: { inventoryItem: { id: vars.inventoryItemId, inventoryLevel: { id: 'x', quantities: [{ name: 'available', quantity: 7 }] } } } };
    levels[vars.inventoryItemId] = 6; // a unit sells right after the read
    return r;
  };
  const { json } = await postUpdate([product(1, { quantity: 50 })]);
  assert.equal(json.results[0].success, false);
  assert.match(json.results[0].error, /stock changed while saving/);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 6); // the sale is preserved
  assert.ok(!('quantity' in JSON.parse(editLogs[0].previousValues)));
});

test('the previous payload (ignoreCompareQuantity) is rejected by the 2026-04 schema mock', () => {
  const old: any = {
    name: 'available',
    reason: 'correction',
    ignoreCompareQuantity: true,
    quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantity: 200 }],
  };
  assert.match(validateSetInput2026_04(old)![0].message, /ignoreCompareQuantity \(Field is not defined on InventorySetQuantitiesInput\)/);
  // ...and omitting changeFromQuantity is also rejected on 2026-04.
  const withoutIgnore: Record<string, unknown> = { ...old };
  delete withoutIgnore.ignoreCompareQuantity;
  assert.match(validateSetInput2026_04(withoutIgnore)![0].message, /changeFromQuantity must be provided/);
});

test('a mutation without @idempotent is rejected by the 2026-04 mock', () => {
  const legacy = 'mutation InvSet($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { field message } } }';
  assert.match(validateIdempotency(legacy, { input: {} })![0].message, /@idempotent directive is required/);
});

test('each inventory mutation gets its own idempotency key', async () => {
  await postUpdate([1, 2, 3].map((n) => product(n, { quantity: 5 })));
  const keys = callsOf('invSet').map((c) => c.variables.idempotencyKey);
  assert.equal(keys.length, 3);
  keys.forEach((k) => assert.match(k, UUID_RE));
  assert.equal(new Set(keys).size, 3);
});

test('inventoryActivate carries @idempotent with a fresh UUID key per call (required on 2026-04)', async () => {
  await postUpdate([1, 2].map((n) => product(n, { quantity: 5 })));
  const activates = callsOf('invActivate');
  assert.equal(activates.length, 2);
  for (const c of activates) {
    assert.match(c.query, /inventoryActivate\(inventoryItemId: \$inventoryItemId, locationId: \$locationId\)\s*@idempotent\(key: \$idempotencyKey\)/);
    assert.match(c.query, /\$idempotencyKey: String!/);
    assert.match(c.variables.idempotencyKey, UUID_RE);
  }
  assert.notEqual(activates[0].variables.idempotencyKey, activates[1].variables.idempotencyKey);
});

test('CHANGE_FROM_QUANTITY_STALE user error is reported as a failure', async () => {
  overrides.invSet = () => ({
    data: { inventorySetQuantities: { userErrors: [{ field: ['input', 'quantities', '0', 'changeFromQuantity'], message: 'The quantity has changed since it was last read.', code: 'CHANGE_FROM_QUANTITY_STALE' }] } },
  });
  const { json } = await postUpdate([product(1, { quantity: 10, prevQuantity: 4 })]);
  assert.equal(json.results[0].success, false);
  assert.equal(json.results[0].error, 'quantity: stock changed while saving (e.g. a sale); not applied, please retry');
  assert.equal(editLogs[0].success, false);
  assert.deepEqual(usageIncrements, []);
});

test('retrying the same request sends the same absolute value (no cumulative adjustment)', async () => {
  await postUpdate([product(1, { quantity: 200 })]);
  await postUpdate([product(1, { quantity: 200 })]);
  const sets = callsOf('invSet');
  assert.equal(sets.length, 2);
  // Same absolute target both times; the CAS guard reflects the freshly read value (7, then 200).
  assert.deepEqual(sets.map((c) => c.variables.input.quantities[0].quantity), [200, 200]);
  assert.deepEqual(sets.map((c) => c.variables.input.quantities[0].changeFromQuantity), [7, 200]);
  // A retry is a new logical operation, so it gets a new idempotency key.
  assert.notEqual(sets[0].variables.idempotencyKey, sets[1].variables.idempotencyKey);
});

// ---------------------------------------------------------------------------
// 8. No regression in price / vendor / other bulk edit features
// ---------------------------------------------------------------------------
test('price-only update is unchanged and makes no inventory calls', async () => {
  const { json } = await postUpdate([product(1, { price: '19.99', prevPrice: '24.99' })]);
  assert.deepEqual(json.results[0], { productId: 'gid://shopify/Product/1', success: true, error: null, changes: { price: '19.99' } });
  assert.deepEqual(callsOf('variantPrice')[0].variables, {
    productId: 'gid://shopify/Product/1',
    variants: [{ id: 'gid://shopify/ProductVariant/1', price: '19.99' }],
  });
  assert.equal(callsOf('locations').length, 0);
  assert.equal(calls.filter((c) => opName(c.query).startsWith('inv')).length, 0);
  assert.deepEqual(JSON.parse(editLogs[0].previousValues), { price: '24.99', variantId: 'gid://shopify/ProductVariant/1' });
});

test('vendor + price + quantity together all apply in one request', async () => {
  const { json } = await postUpdate([product(1, { vendor: 'ACME', prevVendor: 'Old', price: '10.00', prevPrice: '12.00', quantity: 50, prevQuantity: 4 })]);
  assert.equal(json.results[0].success, true);
  assert.deepEqual(json.results[0].changes, { vendor: 'ACME', price: '10.00', quantity: 50 });
  assert.deepEqual(callsOf('productUpdate')[0].variables, { product: { id: 'gid://shopify/Product/1', vendor: 'ACME' } });
  assert.equal(callsOf('variantPrice').length, 1);
  assert.equal(callsOf('invSet').length, 1);
});

test('a quantity failure does not hide a successful price change (partial result reported)', async () => {
  overrides.invSet = () => ({ data: { inventorySetQuantities: { userErrors: [{ field: null, message: 'nope' }] } } });
  const { json } = await postUpdate([product(1, { price: '10.00', quantity: 50 })]);
  assert.equal(json.results[0].success, false);
  assert.equal(json.results[0].error, 'quantity: nope');
  assert.deepEqual(json.results[0].changes, { price: '10.00' });
});

// ---------------------------------------------------------------------------
// Undo / Restore use the same corrected inventorySetQuantities payload
// ---------------------------------------------------------------------------
test('undo restores the previous absolute quantity with a 2026-01/2026-04-valid payload', async () => {
  editLogRows = [{
    id: 'log1', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
    changes: JSON.stringify({ quantity: 200 }),
    previousValues: JSON.stringify({ quantity: 7, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }),
  }];
  levels['gid://shopify/InventoryItem/1'] = 200;
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'log1' }));
  assert.deepEqual(await res.json(), { success: true });
  const call = callsOf('invSet')[0];
  assert.equal(validateSetInput2026_04(call.variables.input), null);
  assert.equal(validateIdempotency(call.query, call.variables), null);
  assert.deepEqual(call.variables.input, {
    name: 'available', reason: 'correction',
    quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantity: 7, changeFromQuantity: 200 }],
  });
});

test('restore resets the original absolute quantity with a 2026-01/2026-04-valid payload', async () => {
  editLogRows = [
    { id: 'a', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false, changes: JSON.stringify({ quantity: 200 }), previousValues: JSON.stringify({ quantity: 3, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }) },
    { id: 'b', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false, changes: JSON.stringify({ quantity: 80 }), previousValues: JSON.stringify({ quantity: 200, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }) },
  ];
  levels['gid://shopify/InventoryItem/1'] = 80;
  const res = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  const body = await res.json();
  assert.equal(body.success, true);
  const sets = callsOf('invSet');
  assert.equal(sets.length, 1);
  assert.equal(validateSetInput2026_04(sets[0].variables.input), null);
  assert.equal(validateIdempotency(sets[0].query, sets[0].variables), null);
  assert.equal(sets[0].variables.input.quantities[0].quantity, 3);
  assert.equal(sets[0].variables.input.quantities[0].changeFromQuantity, 80); // newest edit's written value
});

test('undo reports Shopify rejection instead of success', async () => {
  editLogRows = [{
    id: 'log2', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
    changes: JSON.stringify({ quantity: 20 }),
    previousValues: JSON.stringify({ quantity: 7, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }),
  }];
  levels['gid://shopify/InventoryItem/1'] = 20;
  overrides.invSet = () => ({ data: { inventorySetQuantities: { userErrors: [{ field: null, message: 'rejected' }] } } });
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'log2' }));
  assert.deepEqual(await res.json(), { success: false, error: 'quantity: rejected' });
});

// ---------------------------------------------------------------------------
// Undo / Restore never overwrite newer stock changes (compare-and-swap)
// ---------------------------------------------------------------------------
const qtyRow = (id: string, written: number, prev: number, extra: Record<string, any> = {}) => ({
  id, shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
  changes: JSON.stringify({ quantity: written, ...(extra.changes ?? {}) }),
  previousValues: JSON.stringify({ quantity: prev, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, ...(extra.prev ?? {}) }),
});

test('undo after a sale returns 409 inventory_conflict and writes NOTHING (not even price)', async () => {
  editLogRows = [qtyRow('c1', 15, 10, { changes: { price: '9.00' }, prev: { price: '12.00', variantId: 'gid://shopify/ProductVariant/1' } })];
  levels['gid://shopify/InventoryItem/1'] = 13; // 2 units sold after the edit
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'c1' }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'inventory_conflict');
  assert.deepEqual(
    { expected: body.conflict.expected, current: body.conflict.current, target: body.conflict.target },
    { expected: 15, current: 13, target: 10 },
  );
  assert.match(body.message, /Nothing was restored/);
  assert.equal(callsOf('invSet').length, 0);
  assert.equal(callsOf('variantPrice').length, 0);
  assert.equal(callsOf('productUpdate').length, 0);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 13);
});

test('undo with explicit acceptCurrentQuantity overwrites only the confirmed value (still CAS-guarded)', async () => {
  editLogRows = [qtyRow('c2', 15, 10)];
  levels['gid://shopify/InventoryItem/1'] = 13;
  const ok = await undoPOST(request('/api/products/undo', { editLogId: 'c2', acceptCurrentQuantity: 13 }));
  assert.deepEqual(await ok.json(), { success: true });
  assert.equal(callsOf('invSet')[0].variables.input.quantities[0].changeFromQuantity, 13);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 10);

  // Stock moved again after the merchant confirmed 13 -> conflict again, nothing written.
  calls = [];
  editLogRows = [qtyRow('c3', 15, 10)];
  levels['gid://shopify/InventoryItem/1'] = 12;
  const again = await undoPOST(request('/api/products/undo', { editLogId: 'c3', acceptCurrentQuantity: 13 }));
  assert.equal(again.status, 409);
  assert.equal(callsOf('invSet').length, 0);
});

test('a sale racing the undo write (CAS stale) is a conflict, not a success', async () => {
  editLogRows = [qtyRow('c4', 15, 10)];
  levels['gid://shopify/InventoryItem/1'] = 15;
  overrides.invSet = () => ({ data: { inventorySetQuantities: { userErrors: [{ code: 'CHANGE_FROM_QUANTITY_STALE', field: null, message: 'stale' }] } } });
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'c4' }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).conflict.current, null);
});

test('undo is a no-op write when stock already equals the target (safe retry after partial undo)', async () => {
  editLogRows = [qtyRow('c5', 15, 10)];
  levels['gid://shopify/InventoryItem/1'] = 10;
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'c5' }));
  assert.deepEqual(await res.json(), { success: true });
  assert.equal(callsOf('invSet').length, 0);
});

test('legacy edit rows without a recorded written quantity require explicit confirmation', async () => {
  editLogRows = [{ ...qtyRow('c6', 0, 10), changes: '{}' }];
  levels['gid://shopify/InventoryItem/1'] = 15;
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'c6' }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).conflict.expected, null);
});

test('restore after a sale returns 409 and writes nothing', async () => {
  editLogRows = [qtyRow('r1', 200, 3), qtyRow('r2', 80, 200)];
  levels['gid://shopify/InventoryItem/1'] = 79;
  const res = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.deepEqual([body.conflict.expected, body.conflict.current, body.conflict.target], [80, 79, 3]);
  assert.equal(callsOf('invSet').length, 0);
  assert.equal(callsOf('productUpdate').length, 0);
});

// ---------------------------------------------------------------------------
// Legacy (pre-CAS) snapshots and multi-location consistency
// ---------------------------------------------------------------------------
const legacyRow = (id: string, written: number, prev: number) => ({
  id, shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
  changes: JSON.stringify({ quantity: written }),
  previousValues: JSON.stringify({ quantity: prev, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }),
});

test('legacy snapshot on a multi-location item: undo and restore return 409 legacy_multi_location and write nothing', async () => {
  stockedLocations['gid://shopify/InventoryItem/1'] = 2;
  levels['gid://shopify/InventoryItem/1'] = 15;
  editLogRows = [legacyRow('lg1', 15, 40)];
  const u = await undoPOST(request('/api/products/undo', { editLogId: 'lg1' }));
  assert.equal(u.status, 409);
  const ub = await u.json();
  assert.equal(ub.conflict.reason, 'legacy_multi_location');
  assert.match(ub.message, /more than one location/);
  const r = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  assert.equal(r.status, 409);
  assert.equal((await r.json()).conflict.reason, 'legacy_multi_location');
  assert.equal(callsOf('invSet').length, 0);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 15);
});

test('legacy snapshot on a multi-location item proceeds only after explicit confirmation (still CAS-guarded)', async () => {
  stockedLocations['gid://shopify/InventoryItem/1'] = 2;
  levels['gid://shopify/InventoryItem/1'] = 15;
  editLogRows = [legacyRow('lg2', 15, 40)];
  const r = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1', acceptCurrentQuantity: 15 }));
  assert.equal((await r.json()).success, true);
  assert.equal(callsOf('invSet')[0].variables.input.quantities[0].changeFromQuantity, 15);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 40);
});

test('legacy snapshot on a single-location item restores normally (total == location value)', async () => {
  levels['gid://shopify/InventoryItem/1'] = 15;
  editLogRows = [legacyRow('lg3', 15, 10)];
  const r = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  assert.equal((await r.json()).success, true);
  assert.equal(callsOf('invLevelCount').length, 1);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 10);
});

test('new (location-scoped) snapshots skip the location-count check', async () => {
  stockedLocations['gid://shopify/InventoryItem/1'] = 2;
  levels['gid://shopify/InventoryItem/1'] = 15;
  editLogRows = [{ ...legacyRow('nw', 15, 10), previousValues: JSON.stringify({ quantity: 10, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantityScope: 'location' }) }];
  const r = await undoPOST(request('/api/products/undo', { editLogId: 'nw' }));
  assert.deepEqual(await r.json(), { success: true });
  assert.equal(callsOf('invLevelCount').length, 0);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 10);
});

test('restore returns 409 inventory_target_mismatch when open quantity edits span different locations; zero Shopify calls, override ignored', async () => {
  levels['gid://shopify/InventoryItem/1'] = 80;
  editLogRows = [
    { ...legacyRow('m1', 200, 3), changes: JSON.stringify({ quantity: 200, title: 'AI title' }), previousValues: JSON.stringify({ quantity: 3, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, title: 'Old title', price: '12.00', variantId: 'gid://shopify/ProductVariant/1' }) },
    { ...legacyRow('m2', 80, 50), previousValues: JSON.stringify({ quantity: 50, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: 'gid://shopify/Location/2', quantityScope: 'location' }) },
  ];
  let markedUndone = 0;
  const realUpdateMany = fakePrisma.editLog.updateMany;
  fakePrisma.editLog.updateMany = async (a: any) => { markedUndone++; return realUpdateMany(a); };
  try {
    for (const extra of [{}, { acceptCurrentQuantity: 80 }]) {
      calls = [];
      const r = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1', ...extra }));
      assert.equal(r.status, 409);
      const b = await r.json();
      assert.equal(b.success, false);
      assert.equal(b.error, 'inventory_target_mismatch');
      assert.equal(
        b.message,
        'The open edits for this product changed stock at different locations or variants, ' +
          'so it cannot be restored automatically. Nothing was restored. Adjust stock manually in Shopify.',
      );
      assert.equal(b.conflict, undefined); // no conflict payload => the UI offers no "set anyway" override
      assert.equal(calls.length, 0, `expected zero Shopify calls, got: ${calls.map((c) => opName(c.query)).join(',')}`);
    }
  } finally {
    fakePrisma.editLog.updateMany = realUpdateMany;
  }
  assert.equal(markedUndone, 0);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 80);
});

test('legacy multi-location row whose stock ALSO changed reports legacy_multi_location first, so a stock_changed override cannot skip the warning', async () => {
  stockedLocations['gid://shopify/InventoryItem/1'] = 2;
  levels['gid://shopify/InventoryItem/1'] = 13; // edit wrote 15, then 2 were sold
  editLogRows = [legacyRow('lg4', 15, 40)];
  for (const call of [
    () => undoPOST(request('/api/products/undo', { editLogId: 'lg4' })),
    () => restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1' })),
  ]) {
    const r = await call();
    assert.equal(r.status, 409);
    const b = await r.json();
    assert.equal(b.conflict.reason, 'legacy_multi_location');
    assert.deepEqual([b.conflict.expected, b.conflict.current, b.conflict.target], [15, 13, 40]);
    assert.match(b.message, /more than one location/);
    assert.match(b.message, /Stock has also changed since the edit \(it was left at 15\)/);
  }
  assert.equal(callsOf('invSet').length, 0);
  // Only after confirming the value shown (13) does it write, still CAS-guarded on 13.
  calls = [];
  const ok = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1', acceptCurrentQuantity: 13 }));
  assert.equal((await ok.json()).success, true);
  assert.equal(callsOf('invSet')[0].variables.input.quantities[0].changeFromQuantity, 13);
  assert.equal(levels['gid://shopify/InventoryItem/1'], 40);
});

// ---------------------------------------------------------------------------
// 9. Server-side request validation (lib/update-validate.ts)
//
// `forbidWrites()` turns every Shopify write mutation into a recorded violation, so a
// test fails if invalid input ever reaches productUpdate / productVariantsBulkUpdate /
// inventoryItemUpdate / inventoryActivate / inventorySetQuantities.
// ---------------------------------------------------------------------------
const WRITE_OPS = ['productUpdate', 'variantPrice', 'invItemUpdate', 'invActivate', 'invSet'];
let writeViolations: string[] = [];
function forbidWrites(allow: (op: string, vars: any) => boolean = () => false) {
  writeViolations = [];
  for (const op of WRITE_OPS) {
    overrides[op] = (vars) => {
      if (allow(op, vars)) return defaultHandler(op, vars, op === 'invSet' ? 'inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey)' : '');
      writeViolations.push(`${op} ${JSON.stringify(vars)}`);
      return { errors: [{ message: `TEST VIOLATION: ${op} must not be called` }] };
    };
  }
}
const writesFor = (n: number) =>
  calls.filter((c) => WRITE_OPS.includes(opName(c.query)) && JSON.stringify(c.variables).match(new RegExp(`/(Product|ProductVariant|InventoryItem)/${n}"`)));

const INVALID_ITEMS: [string, Record<string, any>][] = [
  ['empty price', { price: '' }],
  ['whitespace price', { price: '   ' }],
  ['non-numeric price', { price: 'abc' }],
  ['negative price', { price: '-5' }],
  ['exponent price', { price: '1e3' }],
  ['currency-symbol price', { price: '$10' }],
  ['thousands-separator price', { price: '1,000.00' }],
  ['NaN-like price', { price: 'NaN' }],
  ['negative numeric price', { price: -1 }],
  ['price object', { price: {} }],
  ['price without variant id', { price: '10.00', variantId: null }],
  ['price with malformed variant id', { price: '10.00', variantId: 'not-a-gid' }],
  ['empty quantity', { quantity: '' }],
  ['whitespace quantity', { quantity: '  ' }],
  ['negative quantity', { quantity: -1 }],
  ['negative string quantity', { quantity: '-3' }],
  ['fractional quantity', { quantity: 2.5 }],
  ['exponent quantity', { quantity: '1e3' }],
  ['boolean quantity', { quantity: true }],
  ['huge quantity', { quantity: 1_000_000_001 }],
  ['quantity with malformed inventory item id', { quantity: 3, inventoryItemId: 'abc' }],
  ['empty vendor', { vendor: '' }],
  ['whitespace vendor', { vendor: '   ' }],
  ['non-text vendor', { vendor: 42 }],
  ['over-long vendor', { vendor: 'x'.repeat(256) }],
  ['invalid status', { status: 'deleted' }],
  ['empty product type', { productType: '' }],
  ['tags not a list', { tags: 'a,b' }],
  ['empty tag', { tags: ['ok', ''] }],
  ['no requested change', {}],
  ['malformed previous price (Undo snapshot)', { price: '5.00', prevPrice: 'abc' }],
];

for (const [label, extra] of INVALID_ITEMS) {
  test(`validation: ${label} alone → 400, zero Shopify calls, nothing logged or counted`, async () => {
    forbidWrites();
    const { status, json } = await postUpdate([product(1, extra)]);
    assert.equal(status, 400);
    assert.equal(json.code, 'no_valid_updates');
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].success, false);
    assert.equal(json.results[0].productId, 'gid://shopify/Product/1');
    assert.ok(typeof json.results[0].error === 'string' && json.results[0].error.length > 0);
    assert.deepEqual(writeViolations, []);
    assert.equal(calls.length, 0, 'no Shopify call at all (not even the token probe or billing gate)');
    assert.deepEqual(editLogs, []);
    assert.deepEqual(usageIncrements, []);
  });

  test(`validation: ${label} next to a valid item → whole request rejected, nothing written`, async () => {
    forbidWrites();
    const { status, json } = await postUpdate([product(1, extra), product(2, { quantity: 4, price: '9.99', vendor: 'ACME' })]);
    assert.equal(status, 400);
    assert.equal(json.code, 'invalid_updates');
    assert.equal(json.results[0].success, false);
    assert.equal(json.results[0].productId, 'gid://shopify/Product/1');
    assert.ok(json.results[0].error);
    assert.equal(json.results[1].success, false);
    assert.equal(json.results[1].error, null, 'the valid item is not blamed, just not applied');
    assert.deepEqual(writeViolations, []);
    assert.equal(writesFor(2).length, 0);
    assert.equal(calls.length, 0);
    assert.deepEqual(editLogs, []);
    assert.deepEqual(usageIncrements, []);
  });
}

test('validation: specific error messages for price, quantity and vendor', async () => {
  const { json } = await postUpdate([
    product(1, { price: '' }),
    product(2, { quantity: '' }),
    product(3, { quantity: -1 }),
    product(4, { vendor: '  ' }),
    product(5, { price: '1.00', variantId: null }),
    product(6, {}),
  ]);
  assert.match(json.results[0].error, /^price: invalid price/);
  assert.equal(json.results[1].error, 'quantity: invalid quantity (must be a whole number)');
  assert.equal(json.results[2].error, 'quantity: invalid quantity (must be between 0 and 1000000000)');
  assert.equal(json.results[3].error, 'vendor: cannot be empty');
  assert.equal(json.results[4].error, 'price: missing or invalid variant id for this product');
  assert.equal(json.results[5].error, 'No changes requested for this product');
});

test('validation: quantity 0 (number and "0") is a valid absolute value and is written', async () => {
  forbidWrites((op) => op !== 'productUpdate' && op !== 'variantPrice');
  levels['gid://shopify/InventoryItem/1'] = 5;
  levels['gid://shopify/InventoryItem/2'] = 5;
  const { status, json } = await postUpdate([product(1, { quantity: 0 }), product(2, { quantity: '0' })]);
  assert.equal(status, 200);
  assert.ok(json.results.every((r: any) => r.success));
  assert.deepEqual(callsOf('invSet').map((c) => c.variables.input.quantities[0].quantity), [0, 0]);
  assert.deepEqual(writeViolations, []);
});

test('validation: price "0" / "0.00" and a numeric price are valid and sent as strings', async () => {
  const { json } = await postUpdate([product(1, { price: '0' }), product(2, { price: '0.00' }), product(3, { price: 12.5 })]);
  assert.ok(json.results.every((r: any) => r.success));
  assert.deepEqual(callsOf('variantPrice').map((c) => c.variables.variants[0].price), ['0', '0.00', '12.5']);
});

test('validation: vendor is trimmed before it is sent to Shopify', async () => {
  await postUpdate([product(1, { vendor: '  ACME  ' })]);
  assert.equal(callsOf('productUpdate')[0].variables.product.vendor, 'ACME');
});

test('validation: request with only invalid items, mixed kinds → 400 and zero Shopify calls', async () => {
  forbidWrites();
  const { status, json } = await postUpdate([
    product(1, { price: 'abc' }),
    product(2, { quantity: -2 }),
    product(3, { vendor: '' }),
    { quantity: 3 },
    null,
    'garbage',
  ]);
  assert.equal(status, 400);
  assert.equal(json.code, 'no_valid_updates');
  assert.equal(json.results.length, 6);
  assert.ok(json.results.every((r: any) => r.success === false && r.error));
  assert.equal(calls.length, 0);
  assert.deepEqual(writeViolations, []);
});

test('validation: malformed body shapes are rejected before any Shopify call', async () => {
  for (const body of [{}, { updates: null }, { updates: 'x' }, { updates: {} }]) {
    calls = [];
    const res = await updatePOST(request('/api/products/update', body));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'No updates provided');
    assert.equal(calls.length, 0);
  }
  calls = [];
  const raw = new NextRequestCtor('http://localhost/api/products/update', {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken()}`, 'content-type': 'application/json' },
    body: '{not json',
  });
  const res = await updatePOST(raw);
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('validation: more than 50 items in one request → 400 too_many_updates, zero Shopify calls', async () => {
  forbidWrites();
  const many = Array.from({ length: 51 }, (_, i) => product(i + 1, { vendor: 'ACME' }));
  const { status, json } = await postUpdate(many);
  assert.equal(status, 400);
  assert.equal(json.code, 'too_many_updates');
  assert.equal(calls.length, 0);
});

test('validation: unauthenticated request is rejected before validation or any Shopify call', async () => {
  const res = await updatePOST(
    new NextRequestCtor('http://localhost/api/products/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updates: [product(1, { price: 'abc' })] }),
    }),
  );
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});
