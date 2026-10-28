// Client-side validation of the "Bulk edit" panel, run before Preview and Apply.
//
// Without it, invalid input was silently turned into a real write:
//   - empty / non-numeric fixed price -> money('') === '0.00', so every selected product
//     would have been set to $0.00;
//   - empty quantity -> parseInt('') === NaN -> serialized as `null` -> the server skipped
//     the inventory write but still reported the product as updated;
//   - "1.5" quantity -> parseInt -> 1 (silently truncated);
//   - empty vendor -> the server ignores '' and reports success without changing anything.
// Pure function (no React / DOM) so it can be unit-tested.

export type BulkEditInput = {
  applyVendor: boolean;
  vendor: string;
  applyPrice: boolean;
  priceMode: 'multiply' | 'fixed';
  factor: string;
  fixedPrice: string;
  applyQuantity: boolean;
  quantity: string;
};

const DECIMAL = /^\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;

/** Returns a user-facing error message, or null when the input is valid. */
export function validateBulkEdit(i: BulkEditInput): string | null {
  if (!i.applyVendor && !i.applyPrice && !i.applyQuantity) {
    return 'Enable at least one field to edit.';
  }
  if (i.applyVendor && !(i.vendor ?? '').trim()) {
    return 'Enter a vendor name, or untick Vendor.';
  }
  if (i.applyPrice) {
    if (i.priceMode === 'fixed') {
      const v = (i.fixedPrice ?? '').trim();
      if (!DECIMAL.test(v)) return 'Enter a valid fixed price (e.g. 19.99), or untick Price.';
    } else {
      const v = (i.factor ?? '').trim();
      if (!DECIMAL.test(v) || !(parseFloat(v) > 0)) {
        return 'Enter a price factor greater than 0 (e.g. 0.7), or untick Price.';
      }
    }
  }
  if (i.applyQuantity && !WHOLE.test((i.quantity ?? '').trim())) {
    return 'Enter a whole, non-negative inventory quantity (e.g. 100), or untick Inventory quantity.';
  }
  return null;
}
