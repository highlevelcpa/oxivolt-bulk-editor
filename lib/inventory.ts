import { randomUUID } from 'crypto';

// Shared `inventorySetQuantities` payload used by bulk update, undo and restore.
//
// API_VERSION (lib/shopify.ts) still names 2025-07, which Shopify no longer serves:
// requests fall forward to the oldest accessible version (2026-01 today, 2026-04 from
// 2027-01-16). This payload is valid on 2026-01 and on 2026-04+:
//   - `ignoreCompareQuantity` / `compareQuantity` are deprecated in 2026-01 and removed
//     in 2026-04, so they are not sent.
//   - `changeFromQuantity: null` explicitly skips the compare-and-swap check. The app
//     intentionally performs an absolute "set to N" (the merchant's chosen value, or the
//     recorded previous value for undo/restore), exactly as before with
//     `ignoreCompareQuantity: true`. 2026-04 rejects quantities that omit the field.
//   - `@idempotent(key:)` is optional in 2026-01 and required in 2026-04. A fresh key is
//     generated per mutation call (one logical "set" per inventory item).
export const INV_SET_QUANTITIES = `
  mutation InvSet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      userErrors { field message }
    }
  }
`;

export function inventorySetVariables(inventoryItemId: string, locationId: string, quantity: number) {
  return {
    input: {
      name: 'available',
      reason: 'correction',
      quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity: null }],
    },
    idempotencyKey: randomUUID(),
  };
}
