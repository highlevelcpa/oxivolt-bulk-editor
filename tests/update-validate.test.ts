// Unit tests for lib/update-validate.ts (pure; no network, no database).
// Run: node --import tsx --test tests/*.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_UPDATES_PER_REQUEST,
  normalizePrice,
  normalizeQuantity,
  validateUpdateItem,
  validateUpdateRequest,
} from '../lib/update-validate';

const base = {
  productId: 'gid://shopify/Product/1',
  title: 'P1',
  variantId: 'gid://shopify/ProductVariant/1',
  inventoryItemId: 'gid://shopify/InventoryItem/1',
};
const ok = (extra: Record<string, unknown>) => {
  const r = validateUpdateItem({ ...base, ...extra });
  assert.ok(r.ok, `expected valid: ${JSON.stringify(extra)} → ${!r.ok ? r.error : ''}`);
  return r.item;
};
const bad = (extra: Record<string, unknown>, re?: RegExp) => {
  const r = validateUpdateItem({ ...base, ...extra });
  assert.ok(!r.ok, `expected invalid: ${JSON.stringify(extra)}`);
  if (re) assert.match(r.error, re);
  return r;
};

test('normalizePrice accepts plain non-negative decimals only', () => {
  for (const [v, out] of [['19.99', '19.99'], [' 5 ', '5'], ['0', '0'], ['0.00', '0.00'], ['1.234', '1.234'], [12.5, '12.5'], [0, '0']] as const) {
    assert.equal(normalizePrice(v), out);
  }
  for (const v of ['', ' ', 'abc', '-5', '+5', '1e3', '$10', '1,000', '1.2345', '.5', '5.', 'NaN', 'Infinity', -1, NaN, Infinity, 1e21, null, undefined, {}, [], true]) {
    assert.equal(normalizePrice(v), null, `price ${String(v)}`);
  }
});

test('normalizeQuantity accepts whole numbers 0..1e9 (numbers or digit strings)', () => {
  for (const [v, out] of [[0, 0], ['0', 0], [15, 15], ['15', 15], [' 7 ', 7], [1_000_000_000, 1_000_000_000]] as const) {
    assert.equal(normalizeQuantity(v), out);
  }
  for (const v of ['', '  ', -1, '-1', 1.5, '1.5', '1e3', 'abc', 1_000_000_001, NaN, Infinity, true, null, undefined, {}, []]) {
    assert.equal(normalizeQuantity(v), null, `quantity ${String(v)}`);
  }
});

test('price: requested price must be valid and needs a variant id', () => {
  assert.equal(ok({ price: '10.50' }).price, '10.50');
  bad({ price: '' }, /^price: invalid price/);
  bad({ price: 'abc' }, /^price: invalid price/);
  bad({ price: '-1' }, /^price: invalid price/);
  bad({ price: '10', variantId: null }, /variant id/);
  bad({ price: '10', variantId: 'gid://shopify/Product/1' }, /variant id/);
});

test('price: omitted or null price is "not requested"', () => {
  assert.equal(ok({ vendor: 'A' }).price, undefined);
  assert.equal(ok({ vendor: 'A', price: null }).price, undefined);
});

test('quantity: 0 is preserved; empty/negative/fractional/invalid rejected', () => {
  assert.equal(ok({ quantity: 0 }).quantity, 0);
  assert.equal(ok({ quantity: '0' }).quantity, 0);
  assert.equal(ok({ quantity: '42' }).quantity, 42);
  for (const q of ['', ' ', 'abc', 1.5, '12.7', {}, true]) {
    bad({ quantity: q }, /^quantity: invalid quantity \(must be a whole number\)$/);
  }
  bad({ quantity: -1 }, /must be between 0 and 1000000000/);
  bad({ quantity: 1_000_000_001 }, /must be between 0 and 1000000000/);
  bad({ quantity: 3, inventoryItemId: null }, /^quantity: missing inventory item id for this product$/);
  bad({ quantity: 3, inventoryItemId: 'abc' }, /invalid inventory item id/);
});

test('vendor / productType / status / tags', () => {
  assert.equal(ok({ vendor: '  ACME ' }).vendor, 'ACME');
  bad({ vendor: '' }, /^vendor: cannot be empty$/);
  bad({ vendor: '   ' }, /^vendor: cannot be empty$/);
  bad({ vendor: 5 }, /^vendor: must be text$/);
  bad({ vendor: 'x'.repeat(256) }, /at most 255/);
  assert.equal(ok({ vendor: 'x'.repeat(255) }).vendor?.length, 255);
  bad({ productType: '' }, /^productType: cannot be empty$/);
  assert.equal(ok({ status: 'draft' }).status, 'DRAFT');
  bad({ status: 'deleted' }, /^status:/);
  assert.deepEqual(ok({ tags: [] }).tags, []);
  assert.deepEqual(ok({ tags: [' a ', 'b'] }).tags, ['a', 'b']);
  bad({ tags: 'a,b' }, /^tags:/);
  bad({ tags: ['a', ''] }, /^tags:/);
  bad({ tags: Array.from({ length: 251 }, (_, i) => `t${i}`) }, /at most 250/);
});

test('product id and item shape', () => {
  assert.deepEqual(validateUpdateItem({ vendor: 'A' }), { ok: false, productId: '', error: 'Missing product id' });
  assert.deepEqual(validateUpdateItem(null), { ok: false, productId: '', error: 'Invalid update item' });
  assert.deepEqual(validateUpdateItem('x'), { ok: false, productId: '', error: 'Invalid update item' });
  assert.deepEqual(validateUpdateItem([]), { ok: false, productId: '', error: 'Invalid update item' });
  bad({ productId: '123', vendor: 'A' }, /^Invalid product id$/);
  bad({ productId: 'gid://shopify/Product/1 OR 1=1', vendor: 'A' }, /^Invalid product id$/);
  bad({ title: 5, vendor: 'A' }, /^title:/);
});

test('an item with no requested change is rejected', () => {
  bad({}, /^No changes requested for this product$/);
  bad({ vendor: null, price: null, quantity: null, status: null, productType: null, tags: null }, /^No changes requested/);
});

test('Undo snapshot fields must be well-formed', () => {
  assert.equal(ok({ price: '5', prevPrice: '4.00' }).prevPrice, '4.00');
  assert.equal(ok({ price: '5', prevPrice: '' }).prevPrice, '');
  bad({ price: '5', prevPrice: 'abc' }, /^prevPrice:/);
  bad({ vendor: 'A', prevVendor: 5 }, /^prevVendor:/);
  bad({ tags: ['a'], prevTags: 'a' }, /^prevTags:/);
  assert.deepEqual(ok({ tags: ['a'], prevTags: ['b'] }).prevTags, ['b']);
});

test('validateUpdateRequest: empty, oversize, all-invalid, mixed (all-or-nothing)', () => {
  for (const body of [undefined, null, {}, [], 'x', { updates: [] }, { updates: 'x' }]) {
    const r = validateUpdateRequest(body);
    assert.ok(!r.ok && r.status === 400 && r.body.error === 'No updates provided');
  }
  const uniq = (n: number) => Array.from({ length: n }, (_, i) => ({ ...base, productId: `gid://shopify/Product/${i + 1}`, vendor: 'A' }));
  const big = validateUpdateRequest({ updates: uniq(MAX_UPDATES_PER_REQUEST + 1) });
  assert.ok(!big.ok && big.body.code === 'too_many_updates');
  const atLimit = validateUpdateRequest({ updates: uniq(MAX_UPDATES_PER_REQUEST) });
  assert.ok(atLimit.ok && atLimit.items.length === MAX_UPDATES_PER_REQUEST);

  const none = validateUpdateRequest({ updates: [{ ...base, price: '' }, { ...base, quantity: -1 }] });
  assert.ok(!none.ok);
  assert.equal(none.body.code, 'no_valid_updates');
  assert.match(none.body.error, /^No valid updates; nothing was changed\. price: invalid price/);
  assert.deepEqual(none.body.results.map((r: any) => r.success), [false, false]);

  // One invalid item rejects the whole request; the valid item is reported with error null.
  const mixed = validateUpdateRequest({ updates: [{ ...base, price: '' }, { ...base, productId: 'gid://shopify/Product/2', vendor: 'A' }] });
  assert.ok(!mixed.ok);
  assert.equal(mixed.body.code, 'invalid_updates');
  assert.match(mixed.body.error, /^1 of 2 updates are invalid; nothing was changed\. price: invalid price/);
  assert.deepEqual(mixed.body.results.map((r: any) => r.error === null), [false, true]);
});

test('validateUpdateRequest: unknown top-level fields, duplicates, raw updates returned', () => {
  const extra = validateUpdateRequest({ updates: [{ ...base, vendor: 'A' }], dryRun: false });
  assert.ok(!extra.ok && extra.body.code === 'unsupported_field' && /dryRun/.test(extra.body.error));
  const tokenNotAllowed = validateUpdateRequest({ updates: [{ ...base, vendor: 'A' }], previewToken: 'x' });
  assert.ok(!tokenNotAllowed.ok && tokenNotAllowed.body.code === 'unsupported_field');
  const tokenAllowed = validateUpdateRequest({ updates: [{ ...base, vendor: 'A' }], previewToken: 'x' }, ['updates', 'previewToken']);
  assert.ok(tokenAllowed.ok);

  const dup = validateUpdateRequest({ updates: [{ ...base, vendor: 'A' }, { ...base, price: '1.00' }] });
  assert.ok(!dup.ok);
  assert.equal(dup.body.results[1].error, 'Duplicate product in this request');

  const raw = [{ ...base, vendor: '  A  ' }];
  const r = validateUpdateRequest({ updates: raw });
  assert.ok(r.ok);
  assert.equal(r.updates, raw, 'raw array is returned untouched (preview hash input)');
  assert.equal(r.items[0].vendor, 'A');
});

test('unknown item fields are rejected, not silently dropped', () => {
  bad({ vendor: 'A', compareAtPrice: '9.99' }, /^Unsupported field\(s\): compareAtPrice$/);
  bad({ vendor: 'A', operation: 'delete' }, /^Unsupported field/);
  bad({ vendor: 'A', __proto__x: 1 }, /^Unsupported field/);
  bad({ vendor: 'A', variantId: 5 }, /^variantId: must be text$/);
  bad({ vendor: 'A', title: 'x'.repeat(1025) }, /^title: must be at most 1024/);
});

test('Undo snapshot bounds: prev text length, prevTags, prevQuantity', () => {
  assert.equal(ok({ vendor: 'A', prevVendor: '' }).prevVendor, '');
  bad({ vendor: 'A', prevVendor: 'x'.repeat(256) }, /^prevVendor: must be at most 255/);
  bad({ tags: ['a'], prevTags: Array.from({ length: 251 }, () => 't') }, /^prevTags:/);
  bad({ tags: ['a'], prevTags: ['x'.repeat(256)] }, /^prevTags:/);
  assert.equal(ok({ quantity: 1, prevQuantity: -3 }).prevQuantity, -3);
  assert.equal(ok({ quantity: 1, prevQuantity: null }).prevQuantity, null);
  for (const pq of ['5', 1.5, NaN, {}, 2_000_000_000]) bad({ quantity: 1, prevQuantity: pq }, /^prevQuantity:/);
});
