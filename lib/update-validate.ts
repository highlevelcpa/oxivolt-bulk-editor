// Server-side validation for POST /api/products/update.
//
// The browser validates the bulk-edit form, but the API must not trust the client:
// before this module the route would, for example,
//   - write quantity 0 when sent `quantity: ""` (Number("") === 0 passes isInteger),
//   - send negative quantities and malformed prices ("abc", "-5", "1e3") to Shopify,
//   - report success for `price: ""`, `vendor: ""`, or a price without a variant id
//     (the field was silently skipped, nothing was written, result said success).
//
// Each update item is validated independently BEFORE any Shopify call. An invalid item
// is reported as a failed result and never reaches a Shopify mutation; valid items in
// the same request proceed as before. A request with no valid item gets a 400 and the
// route makes no Shopify call at all.
//
// Field semantics (unchanged from the route): a field that is omitted, `undefined` or
// `null` is "not requested". A field that is present with any other value is
// "requested" and must be valid.
//
// Pure module (no Next.js / Prisma imports) so it can be unit-tested directly.

export const MAX_UPDATES_PER_REQUEST = 50;
const MAX_TEXT = 255; // Shopify limit for vendor, product type and each tag
const MAX_TAGS = 250; // Shopify limit for tags per product
const MAX_QUANTITY = 1_000_000_000; // Shopify inventory quantity bound

// Non-negative decimal, at most 3 fraction digits (3-decimal currencies), no exponent,
// sign, currency symbol or thousands separator.
const PRICE_RE = /^\d{1,12}(\.\d{1,3})?$/;
const WHOLE_RE = /^\d{1,10}$/;
const GID = (type: string) => new RegExp(`^gid://shopify/${type}/\\d+$`);
const PRODUCT_GID = GID('Product');
const VARIANT_GID = GID('ProductVariant');
const INVENTORY_ITEM_GID = GID('InventoryItem');
const STATUSES = new Set(['ACTIVE', 'DRAFT', 'ARCHIVED']);

export type UpdateItem = {
  productId: string;
  title?: string | null;
  variantId?: string | null;
  inventoryItemId?: string | null;
  vendor?: string | null;
  price?: string | null;
  quantity?: number | null;
  status?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  prevVendor?: string | null;
  prevPrice?: string | null;
  prevQuantity?: number | null;
  prevStatus?: string | null;
  prevProductType?: string | null;
  prevTags?: string[] | null;
};

export type ItemValidation =
  | { ok: true; item: UpdateItem }
  | { ok: false; productId: string; error: string };

const requested = (v: unknown) => v !== undefined && v !== null;
const show = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

/** Returns the normalized price string, or null when invalid. Accepts strings and finite numbers. */
export function normalizePrice(v: unknown): string | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    v = String(v);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return PRICE_RE.test(s) ? s : null;
}

/** Returns the quantity as a safe integer, or null when invalid. Accepts integers and digit strings. */
export function normalizeQuantity(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && WHOLE_RE.test(v.trim())) n = Number(v.trim());
  else return null;
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_QUANTITY) return null;
  return n;
}

function text(v: unknown, field: string): { value?: string; error?: string } {
  if (typeof v !== 'string') return { error: `${field}: must be text` };
  const s = v.trim();
  if (!s) return { error: `${field}: cannot be empty` };
  if (s.length > MAX_TEXT) return { error: `${field}: must be at most ${MAX_TEXT} characters` };
  return { value: s };
}

function tagList(v: unknown, field: string): { value?: string[]; error?: string } {
  if (!Array.isArray(v)) return { error: `${field}: must be a list of tags` };
  if (v.length > MAX_TAGS) return { error: `${field}: at most ${MAX_TAGS} tags` };
  const out: string[] = [];
  for (const t of v) {
    const r = text(t, field);
    if (r.error) return { error: `${field}: every tag must be non-empty text of at most ${MAX_TEXT} characters` };
    out.push(r.value!);
  }
  return { value: out };
}

const optionalText = (v: unknown) => v === undefined || v === null || typeof v === 'string';

/** Validates and normalizes one update item. Never throws. */
export function validateUpdateItem(raw: unknown): ItemValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, productId: '', error: 'Invalid update item' };
  }
  const u = raw as Record<string, any>;
  const productId = typeof u.productId === 'string' ? u.productId : '';
  if (!productId) return { ok: false, productId: '', error: 'Missing product id' };
  const fail = (error: string): ItemValidation => ({ ok: false, productId, error });
  if (!PRODUCT_GID.test(productId)) return fail('Invalid product id');
  if (!optionalText(u.title)) return fail('title: must be text');

  const item: UpdateItem = {
    productId,
    title: u.title ?? null,
    variantId: u.variantId ?? null,
    inventoryItemId: u.inventoryItemId ?? null,
  };
  let changes = 0;

  if (requested(u.vendor)) {
    const r = text(u.vendor, 'vendor');
    if (r.error) return fail(r.error);
    item.vendor = r.value;
    changes++;
  }
  if (requested(u.status)) {
    const s = typeof u.status === 'string' ? u.status.trim().toUpperCase() : '';
    if (!STATUSES.has(s)) return fail(`status: must be ACTIVE, DRAFT or ARCHIVED (got ${show(u.status)})`);
    item.status = s;
    changes++;
  }
  if (requested(u.productType)) {
    const r = text(u.productType, 'productType');
    if (r.error) return fail(r.error);
    item.productType = r.value;
    changes++;
  }
  if (requested(u.tags)) {
    const r = tagList(u.tags, 'tags');
    if (r.error) return fail(r.error);
    item.tags = r.value;
    changes++;
  }
  if (requested(u.price)) {
    const p = normalizePrice(u.price);
    if (p === null) {
      return fail(`price: invalid price ${show(u.price)} (must be a non-negative number such as 19.99)`);
    }
    if (typeof u.variantId !== 'string' || !VARIANT_GID.test(u.variantId)) {
      return fail('price: missing or invalid variant id for this product');
    }
    item.price = p;
    changes++;
  }
  if (requested(u.quantity)) {
    const q = normalizeQuantity(u.quantity);
    if (q === null) {
      // Keep the pre-existing message for non-integers (clients/tests rely on it).
      const n = typeof u.quantity === 'number' ? u.quantity : Number.NaN;
      return fail(
        Number.isSafeInteger(n)
          ? `quantity: invalid quantity (must be between 0 and ${MAX_QUANTITY})`
          : 'quantity: invalid quantity (must be a whole number)',
      );
    }
    if (!requested(u.inventoryItemId)) return fail('quantity: missing inventory item id for this product');
    if (typeof u.inventoryItemId !== 'string' || !INVENTORY_ITEM_GID.test(u.inventoryItemId)) {
      return fail('quantity: invalid inventory item id for this product');
    }
    item.quantity = q;
    changes++;
  }
  if (changes === 0) return fail('No changes requested for this product');

  // Previous values are stored as the Undo snapshot and later written back to Shopify,
  // so they must be well-formed too. prevQuantity is not used (the server reads stock).
  if (requested(u.prevPrice) && u.prevPrice !== '') {
    const pp = normalizePrice(u.prevPrice);
    if (pp === null) return fail(`prevPrice: invalid price ${show(u.prevPrice)}`);
    item.prevPrice = pp;
  } else if (u.prevPrice !== undefined) item.prevPrice = u.prevPrice;
  for (const k of ['prevVendor', 'prevStatus', 'prevProductType'] as const) {
    if (!optionalText(u[k])) return fail(`${k}: must be text`);
    if (u[k] !== undefined) item[k] = u[k];
  }
  if (requested(u.prevTags)) {
    if (!Array.isArray(u.prevTags) || !u.prevTags.every((t: unknown) => typeof t === 'string')) {
      return fail('prevTags: must be a list of tags');
    }
    item.prevTags = u.prevTags;
  }
  if (u.prevQuantity !== undefined) item.prevQuantity = u.prevQuantity;

  return { ok: true, item };
}

export type RequestValidation =
  | { ok: true; results: ItemValidation[]; validCount: number }
  | { ok: false; status: 400; body: Record<string, any> };

/** Validates the whole request body. A 400 result means: make no Shopify call at all. */
export function validateUpdateRequest(body: unknown): RequestValidation {
  const updates = (body as any)?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return { ok: false, status: 400, body: { error: 'No updates provided' } };
  }
  if (updates.length > MAX_UPDATES_PER_REQUEST) {
    return {
      ok: false,
      status: 400,
      body: { error: `Too many updates in one request (max ${MAX_UPDATES_PER_REQUEST})`, code: 'too_many_updates' },
    };
  }
  const results = updates.map(validateUpdateItem);
  const validCount = results.filter((r) => r.ok).length;
  if (validCount === 0) {
    const first = results.find((r): r is Extract<ItemValidation, { ok: false }> => !r.ok);
    return {
      ok: false,
      status: 400,
      body: {
        error: `No valid updates; nothing was changed. ${first?.error ?? ''}`.trim(),
        code: 'no_valid_updates',
        results: results.map((r) => ({
          productId: r.ok ? r.item.productId : r.productId,
          success: false,
          error: r.ok ? null : r.error,
        })),
      },
    };
  }
  return { ok: true, results, validCount };
}
