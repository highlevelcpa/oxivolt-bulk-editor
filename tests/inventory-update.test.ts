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
// Shopify Admin API 2025-07 schema rules for inventorySetQuantities.
// ---------------------------------------------------------------------------
const SET_INPUT_FIELDS_2025_07 = ['name', 'reason', 'referenceDocumentUri', 'quantities', 'ignoreCompareQuantity'];
const QTY_INPUT_FIELDS_2025_07 = ['inventoryItemId', 'locationId', 'quantity', 'compareQuantity'];

// Mirrors the top-level GraphQL error Shopify returns for unknown input fields.
function validateSetInput2025_07(input: any): any[] | null {
  for (const k of Object.keys(input ?? {})) {
    if (!SET_INPUT_FIELDS_2025_07.includes(k)) {
      return [{ message: `Variable $input of type InventorySetQuantitiesInput! was provided invalid value for ${k} (Field is not defined on InventorySetQuantitiesInput)` }];
    }
  }
  const quantities = Array.isArray(input?.quantities) ? input.quantities : [];
  for (let i = 0; i < quantities.length; i++) {
    for (const k of Object.keys(quantities[i] ?? {})) {
      if (!QTY_INPUT_FIELDS_2025_07.includes(k)) {
        return [{ message: `Variable $input of type InventorySetQuantitiesInput! was provided invalid value for quantities.${i}.${k} (Field is not defined on InventoryQuantityInput)` }];
      }
    }
    for (const req of ['inventoryItemId', 'locationId', 'quantity']) {
      if (quantities[i]?.[req] === undefined || quantities[i]?.[req] === null) {
        return [{ message: `Variable $input of type InventorySetQuantitiesInput! was provided invalid value for quantities.${i}.${req} (Expected value to not be null)` }];
      }
    }
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

function opName(query: string): string {
  if (query.includes('shop { id }')) return 'probe';
  if (query.includes('currentAppInstallation')) return 'billing';
  if (query.includes('locations(')) return 'locations';
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

function defaultHandler(op: string, vars: any): any {
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
    case 'invSet': {
      const errors = validateSetInput2025_07(vars?.input);
      if (errors) return { errors };
      // 2025-07 runtime rule: compare check must be provided or explicitly ignored.
      const ignore = vars?.input?.ignoreCompareQuantity === true;
      const missingCompare = (vars?.input?.quantities ?? []).some((q: any) => q?.compareQuantity === undefined);
      if (!ignore && missingCompare) {
        return {
          data: {
            inventorySetQuantities: {
              userErrors: [{ field: ['input', 'ignoreCompareQuantity'], message: 'The compareQuantity argument must be given to each quantity or ignored using ignoreCompareQuantity.' }],
            },
          },
        };
      }
      return { data: { inventorySetQuantities: { userErrors: [] } } };
    }
    default:
      return { errors: [{ message: 'unexpected query in test' }] };
  }
}

const fetchMock = async (url: any, init: any) => {
  const href = String(url);
  assert.ok(href.startsWith(`https://${SHOP}/admin/api/2025-07/graphql.json`), `unexpected fetch ${href}`);
  const body = JSON.parse(init?.body ?? '{}');
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const op = opName(body.query);
  calls.push({ query: body.query, variables: body.variables, headers });
  const handler = overrides[op];
  const result = handler ? handler(body.variables) : defaultHandler(op, body.variables);
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

before(async () => {
  (globalThis as any).fetch = fetchMock;
  NextRequestCtor = (await import('next/server')).NextRequest;
  updatePOST = (await import('../app/api/products/update/route')).POST;
  undoPOST = (await import('../app/api/products/undo/route')).POST;
  restorePOST = (await import('../app/api/products/restore/route')).POST;
});

beforeEach(() => {
  calls = [];
  overrides = {};
  editLogs = [];
  usageIncrements = [];
  editLogRows = [];
  locationsResponse = { locations: { edges: [{ node: { id: LOCATION_ID } }] } };
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

async function postUpdate(updates: any[]) {
  const res = await updatePOST(request('/api/products/update', { updates }));
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
test('sets an absolute available quantity with a 2025-07-valid payload', async () => {
  const { status, json } = await postUpdate([product(1, { quantity: 200, prevQuantity: 7 })]);
  assert.equal(status, 200);
  assert.deepEqual(json.results, [
    { productId: 'gid://shopify/Product/1', success: true, error: null, changes: { quantity: 200 } },
  ]);

  const sets = callsOf('invSet');
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].variables, {
    input: {
      name: 'available',
      reason: 'correction',
      ignoreCompareQuantity: true,
      quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantity: 200 }],
    },
  });
  assert.equal(validateSetInput2025_07(sets[0].variables.input), null);
  assert.ok(!JSON.stringify(sets[0].variables).includes('changeFromQuantity'));

  // Undo data preserved.
  assert.equal(editLogs.length, 1);
  assert.equal(editLogs[0].success, true);
  assert.deepEqual(JSON.parse(editLogs[0].previousValues), {
    quantity: 7,
    inventoryItemId: 'gid://shopify/InventoryItem/1',
    locationId: LOCATION_ID,
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
  assert.deepEqual(callsOf('invActivate').map((c) => c.variables), [1, 2, 3].map((n) => ({ inventoryItemId: `gid://shopify/InventoryItem/${n}`, locationId: LOCATION_ID })));
  assert.deepEqual(usageIncrements, [3]);
});

test('one failing product does not mark the others as failed (and vice versa)', async () => {
  overrides.invSet = (vars) => {
    const id = vars.input.quantities[0].inventoryItemId;
    if (id.endsWith('/2')) {
      return { data: { inventorySetQuantities: { userErrors: [{ field: ['input'], message: 'Inventory item not found' }] } } };
    }
    return defaultHandler('invSet', vars);
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
  assert.deepEqual(order, ['invItemUpdate', 'invActivate', 'invSet']);
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
  assert.equal(json.results[0].error, 'quantity: fetch failed');
  assert.match(json.results[1].error, /quantity: Shopify API error 500/);
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

test('missing inventory item id fails that product only', async () => {
  const { json } = await postUpdate([product(1, { quantity: 3, inventoryItemId: null }), product(2, { quantity: 3 })]);
  assert.equal(json.results[0].success, false);
  assert.equal(json.results[0].error, 'quantity: missing inventory item id for this product');
  assert.equal(json.results[1].success, true);
  assert.equal(callsOf('invSet').length, 1);
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
test('compare check is explicitly skipped (absolute set) using the 2025-07 field, not changeFromQuantity', async () => {
  await postUpdate([product(1, { quantity: 200, prevQuantity: 999 })]);
  const input = callsOf('invSet')[0].variables.input;
  assert.equal(input.ignoreCompareQuantity, true);
  for (const q of input.quantities) {
    assert.ok(!('changeFromQuantity' in q));
    assert.ok(!('compareQuantity' in q));
  }
});

test('the old payload (changeFromQuantity) is rejected by the 2025-07 schema mock — reproduces the reported bug', () => {
  const old = {
    name: 'available',
    reason: 'correction',
    quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantity: 200, changeFromQuantity: null }],
  };
  const errs = validateSetInput2025_07(old);
  assert.ok(errs);
  assert.match(errs![0].message, /quantities\.0\.changeFromQuantity \(Field is not defined on InventoryQuantityInput\)/);
});

test('retrying the same request sends the same absolute value (no cumulative adjustment)', async () => {
  await postUpdate([product(1, { quantity: 200 })]);
  await postUpdate([product(1, { quantity: 200 })]);
  const sets = callsOf('invSet');
  assert.equal(sets.length, 2);
  assert.deepEqual(sets[0].variables, sets[1].variables);
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
test('undo restores the previous absolute quantity with a 2025-07-valid payload', async () => {
  editLogRows = [{
    id: 'log1', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
    previousValues: JSON.stringify({ quantity: 7, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }),
  }];
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'log1' }));
  assert.deepEqual(await res.json(), { success: true });
  const input = callsOf('invSet')[0].variables.input;
  assert.equal(validateSetInput2025_07(input), null);
  assert.deepEqual(input, {
    name: 'available', reason: 'correction', ignoreCompareQuantity: true,
    quantities: [{ inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID, quantity: 7 }],
  });
});

test('restore resets the original absolute quantity with a 2025-07-valid payload', async () => {
  editLogRows = [
    { id: 'a', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false, previousValues: JSON.stringify({ quantity: 3, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }) },
    { id: 'b', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false, previousValues: JSON.stringify({ quantity: 200, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }) },
  ];
  const res = await restorePOST(request('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  const body = await res.json();
  assert.equal(body.success, true);
  const sets = callsOf('invSet');
  assert.equal(sets.length, 1);
  assert.equal(validateSetInput2025_07(sets[0].variables.input), null);
  assert.equal(sets[0].variables.input.quantities[0].quantity, 3);
});

test('undo reports Shopify rejection instead of success', async () => {
  editLogRows = [{
    id: 'log2', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
    previousValues: JSON.stringify({ quantity: 7, inventoryItemId: 'gid://shopify/InventoryItem/1', locationId: LOCATION_ID }),
  }];
  overrides.invSet = () => ({ data: { inventorySetQuantities: { userErrors: [{ field: null, message: 'rejected' }] } } });
  const res = await undoPOST(request('/api/products/undo', { editLogId: 'log2' }));
  assert.deepEqual(await res.json(), { success: false, error: 'quantity: rejected' });
});
