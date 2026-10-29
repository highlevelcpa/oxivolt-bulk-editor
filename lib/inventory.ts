import { randomUUID } from 'crypto';
import { shopifyGraphQL } from './shopify';

// Shared `inventorySetQuantities` payload used by bulk update, undo and restore.
//
// API_VERSION (lib/shopify.ts) explicitly targets 2026-04, where these rules are enforced:
//   - `ignoreCompareQuantity` / `compareQuantity` are deprecated in 2026-01 and removed
//     in 2026-04, so they are not sent.
//   - `changeFromQuantity` is the compare-and-swap (CAS) guard: Shopify only applies the
//     set if the location's current quantity equals it, otherwise it returns the
//     CHANGE_FROM_QUANTITY_STALE user error. Every write in this app passes the value it
//     just read (bulk update) or the value its own edit wrote (undo/restore), so a sale or
//     another app's change made in between is never silently overwritten.
//   - `@idempotent(key:)` is optional in 2026-01 and required in 2026-04. A fresh key is
//     generated per mutation call (one logical "set" per inventory item).
export const INV_SET_QUANTITIES = `
  mutation InvSet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      userErrors { code field message }
    }
  }
`;

export function inventorySetVariables(
  inventoryItemId: string,
  locationId: string,
  quantity: number,
  changeFromQuantity: number | null,
) {
  // 2026-04 requires the key on every quantity. JSON.stringify drops `undefined` (key
  // omitted -> rejected by Shopify; flagged as deprecated usage on older versions) and turns
  // NaN/Infinity into `null` (silently disabling the CAS guard), so only a safe integer
  // or an explicit null may be sent.
  if (changeFromQuantity !== null && !Number.isSafeInteger(changeFromQuantity)) {
    throw new Error('quantity: changeFromQuantity must be an integer or null');
  }
  return {
    input: {
      name: 'available',
      reason: 'correction',
      quantities: [{ inventoryItemId, locationId, quantity, changeFromQuantity }],
    },
    idempotencyKey: randomUUID(),
  };
}

export const INV_LEVEL_QUERY = `
  query InvLevel($inventoryItemId: ID!, $locationId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      id
      inventoryLevel(locationId: $locationId) {
        id
        quantities(names: ["available"]) { name quantity }
      }
    }
  }
`;

// Current `available` quantity of one item at one location, or null if the item is not
// stocked there. Throws on transport / top-level GraphQL errors (see shopifyGraphQL).
export async function readAvailable(
  shop: string,
  accessToken: string,
  inventoryItemId: string,
  locationId: string,
): Promise<number | null> {
  const d: any = await shopifyGraphQL(shop, accessToken, INV_LEVEL_QUERY, { inventoryItemId, locationId });
  const q = (d?.inventoryItem?.inventoryLevel?.quantities ?? []).find((x: any) => x?.name === 'available');
  return typeof q?.quantity === 'number' ? q.quantity : null;
}

export function isStaleQuantityError(errs: any): boolean {
  return Array.isArray(errs) && errs.some((e: any) => e?.code === 'CHANGE_FROM_QUANTITY_STALE');
}

// Marker stored in EditLog.previousValues next to `quantity` by the bulk update route
// since the CAS change. Rows WITHOUT it are legacy: their `quantity` is the client's
// variant total across ALL locations, not the value at `locationId`.
export const QUANTITY_SCOPE_LOCATION = 'location';

export const INV_LEVEL_COUNT_QUERY = `
  query InvLevelCount($inventoryItemId: ID!) {
    inventoryItem(id: $inventoryItemId) {
      id
      inventoryLevels(first: 2) { edges { node { id } } }
    }
  }
`;

// Number of locations the item is stocked at (capped at 2: we only need "1" vs "more").
export async function countStockedLocations(shop: string, accessToken: string, inventoryItemId: string): Promise<number> {
  const d: any = await shopifyGraphQL(shop, accessToken, INV_LEVEL_COUNT_QUERY, { inventoryItemId });
  return (d?.inventoryItem?.inventoryLevels?.edges ?? []).length;
}

export type InventoryConflict = {
  field: 'quantity';
  // stock_changed: Shopify no longer holds the value our edit wrote.
  // legacy_multi_location: pre-CAS snapshot (cross-location total) on an item stocked at
  // more than one location, so the target may be wrong; needs explicit confirmation.
  reason: 'stock_changed' | 'legacy_multi_location';
  inventoryItemId: string;
  locationId: string;
  expected: number | null; // what our edit left behind
  current: number | null; // what Shopify holds now (null = unknown / lost a race)
  target: number; // what undo/restore wanted to set
};

export type GuardedRevertResult =
  | { ok: true; changed: boolean }
  | { ok: false; conflict: InventoryConflict }
  | { ok: false; error: string };

/**
 * Undo/restore an inventory quantity WITHOUT overwriting newer stock movements.
 *
 * `expected` is the quantity our own edit wrote. The revert only happens if Shopify
 * still holds exactly that value (checked by a read AND enforced atomically by
 * `changeFromQuantity`). If the merchant explicitly confirmed overwriting the newer
 * value they were shown, pass it as `acceptCurrent`; it is still CAS-guarded, so a
 * further change between confirmation and write is also caught.
 */
export async function revertQuantityGuarded(
  shop: string,
  accessToken: string,
  args: {
    inventoryItemId: string;
    locationId: string;
    target: number;
    expected: number | null;
    acceptCurrent?: number | null;
    legacySnapshot?: boolean;
  },
): Promise<GuardedRevertResult> {
  const { inventoryItemId, locationId, target, expected } = args;
  const confirmed = typeof args.acceptCurrent === 'number';
  const compareTo = confirmed ? (args.acceptCurrent as number) : expected;
  const conflict = (
    current: number | null,
    reason: InventoryConflict['reason'] = 'stock_changed',
  ): GuardedRevertResult => ({
    ok: false,
    conflict: { field: 'quantity', reason, inventoryItemId, locationId, expected, current, target },
  });

  let current: number | null;
  try {
    current = await readAvailable(shop, accessToken, inventoryItemId, locationId);
  } catch (e: any) {
    return { ok: false, error: `quantity: could not read current stock (${e?.message ?? 'error'})` };
  }
  if (current === null) {
    return { ok: false, error: 'quantity: item is no longer stocked at the recorded location' };
  }
  // Already at the target (e.g. retry after a partial undo): nothing to write, nothing to lose.
  if (current === target) return { ok: true, changed: false };
  // Legacy snapshot: only trustworthy when the item is stocked at exactly one location
  // (then the variant total == the location value). Otherwise ask the merchant first.
  // Checked BEFORE the stock_changed comparison: the confirmation sent back for a
  // stock_changed conflict (acceptCurrent) also skips this check, so the merchant must have
  // seen the legacy warning before any override can write a possibly cross-location total.
  if (args.legacySnapshot && !confirmed) {
    let n: number;
    try {
      n = await countStockedLocations(shop, accessToken, inventoryItemId);
    } catch (e: any) {
      return { ok: false, error: `quantity: could not check stock locations (${e?.message ?? 'error'})` };
    }
    if (n !== 1) return conflict(current, 'legacy_multi_location');
  }
  if (compareTo === null || current !== compareTo) return conflict(current);

  try {
    const d: any = await shopifyGraphQL(
      shop,
      accessToken,
      INV_SET_QUANTITIES,
      inventorySetVariables(inventoryItemId, locationId, target, compareTo),
    );
    const errs = d?.inventorySetQuantities?.userErrors;
    if (isStaleQuantityError(errs)) return conflict(null); // changed between read and write
    if (Array.isArray(errs) && errs.length > 0) {
      return { ok: false, error: `quantity: ${errs.map((e: any) => e?.message).filter(Boolean).join('; ')}` };
    }
    return { ok: true, changed: true };
  } catch (e: any) {
    return { ok: false, error: `quantity: ${e?.message ?? 'error'}` };
  }
}

export function conflictMessage(c: InventoryConflict): string {
  if (c.reason === 'legacy_multi_location') {
    const moved =
      c.current !== c.expected
        ? ` Stock has also changed since the edit (it was left at ${c.expected === null ? 'an unknown value' : c.expected}).`
        : '';
    return (
      `This edit was saved before per-location stock snapshots, and this item is stocked at ` +
      `more than one location, so the saved original (${c.target}) may be the total across all ` +
      `locations.${moved} Nothing was restored. Restoring would set stock at this location to ` +
      `${c.target} (currently ${c.current}).`
    );
  }
  const now = c.current === null ? 'it changed again while restoring' : `it is now ${c.current}`;
  const was = c.expected === null ? 'an unknown value' : String(c.expected);
  return (
    `Stock changed after this edit (it was left at ${was}, ${now}) — likely a sale, a return, ` +
    `or another app. Nothing was restored. Restoring would set stock to ${c.target}.`
  );
}
