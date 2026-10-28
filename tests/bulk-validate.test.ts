// Regression tests for AUD-01: invalid "Bulk edit" input must be rejected before any write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBulkEdit, type BulkEditInput } from '../lib/bulk-validate';

const valid: BulkEditInput = {
  applyVendor: true,
  vendor: 'OXIVOLT',
  applyPrice: true,
  priceMode: 'multiply',
  factor: '0.7',
  fixedPrice: '52.82',
  applyQuantity: true,
  quantity: '100',
};
const v = (o: Partial<BulkEditInput>) => validateBulkEdit({ ...valid, ...o });

test('default panel values are valid', () => {
  assert.equal(validateBulkEdit(valid), null);
});

test('no field enabled is rejected', () => {
  assert.match(v({ applyVendor: false, applyPrice: false, applyQuantity: false }) ?? '', /at least one field/);
});

test('empty fixed price is rejected (previously became $0.00)', () => {
  assert.match(v({ priceMode: 'fixed', fixedPrice: '' }) ?? '', /fixed price/);
  assert.match(v({ priceMode: 'fixed', fixedPrice: '   ' }) ?? '', /fixed price/);
});

test('non-numeric or negative fixed price is rejected', () => {
  for (const fixedPrice of ['abc', '-5', '1e3', '12.', '$10']) {
    assert.ok(v({ priceMode: 'fixed', fixedPrice }), `expected rejection for ${fixedPrice}`);
  }
});

test('valid fixed prices pass, including 0 and decimals', () => {
  for (const fixedPrice of ['0', '19.99', ' 52.82 ', '100']) {
    assert.equal(v({ priceMode: 'fixed', fixedPrice }), null, fixedPrice);
  }
});

test('factor must be a number greater than 0', () => {
  for (const factor of ['', '0', '0.0', '-1', 'x']) {
    assert.match(v({ priceMode: 'multiply', factor }) ?? '', /factor/, `factor=${factor}`);
  }
  assert.equal(v({ priceMode: 'multiply', factor: '1.15' }), null);
});

test('fixed-mode validation ignores the factor field and vice versa', () => {
  assert.equal(v({ priceMode: 'fixed', factor: '' }), null);
  assert.equal(v({ priceMode: 'multiply', fixedPrice: '' }), null);
});

test('quantity must be a whole non-negative number (previously NaN -> silently skipped)', () => {
  for (const quantity of ['', ' ', '1.5', '-3', 'abc', '10a']) {
    assert.match(v({ quantity }) ?? '', /quantity/, `quantity=${JSON.stringify(quantity)}`);
  }
  assert.equal(v({ quantity: '0' }), null);
  assert.equal(v({ quantity: ' 25 ' }), null);
});

test('empty vendor is rejected only when Vendor is enabled', () => {
  assert.match(v({ vendor: '  ' }) ?? '', /vendor/);
  assert.equal(v({ applyVendor: false, vendor: '' }), null);
});

test('disabled fields are not validated', () => {
  assert.equal(
    v({ applyPrice: false, fixedPrice: '', factor: '', priceMode: 'fixed', applyQuantity: false, quantity: '' }),
    null,
  );
});
