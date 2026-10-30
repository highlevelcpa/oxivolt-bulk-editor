// Server-side Preview -> Apply binding for bulk edits.
//
// POST /api/products/preview validates a batch and returns a signed, short-lived token
// that commits to (a) the shop from the verified session token and (b) a SHA-256 hash of
// the exact `updates` array that was previewed. POST /api/products/update refuses to
// make any Shopify call unless it receives a token that verifies for the same shop and
// the byte-for-byte same (canonicalized) `updates` array, before the token expires.
//
// Stateless by design (HMAC, no DB table), so no schema migration is needed. The known
// trade-off: a token can be replayed until it expires (default 10 minutes), i.e. the
// exact same previewed batch can be applied again within that window. Every write is
// still an absolute set (not cumulative), so a replay re-applies the same values.
//
// Pure module (Node crypto only) so it can be unit-tested directly.
import crypto from 'node:crypto';

export const PREVIEW_TTL_MS = 10 * 60 * 1000;
const VERSION = 1;
const DOMAIN = 'oxivolt-preview-v1'; // domain separation from other uses of the app secret
const MAX_TOKEN_LENGTH = 2048;
const CLOCK_SKEW_MS = 60 * 1000;

export type PreviewFailure = {
  ok: false;
  status: 400 | 403 | 409 | 428;
  code: 'preview_required' | 'preview_invalid' | 'preview_shop_mismatch' | 'preview_expired' | 'preview_mismatch';
  error: string;
};
export type PreviewCheck = { ok: true; expiresAt: number } | PreviewFailure;

function secret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error('preview signing secret is not configured');
  return s;
}

/** Deterministic JSON: object keys sorted recursively; same value -> same string. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function hashUpdates(updates: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(updates)).digest('base64url');
}

function sign(payloadB64: string): string {
  return crypto.createHmac('sha256', secret()).update(`${DOMAIN}.${payloadB64}`).digest('base64url');
}

export function signPreviewToken(shop: string, updates: unknown, now = Date.now()): { token: string; expiresAt: number } {
  const exp = now + PREVIEW_TTL_MS;
  const payload = {
    v: VERSION,
    shop,
    iat: now,
    exp,
    n: crypto.randomBytes(9).toString('base64url'),
    h: hashUpdates(updates),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${payloadB64}.${sign(payloadB64)}`, expiresAt: exp };
}

const fail = (status: PreviewFailure['status'], code: PreviewFailure['code'], error: string): PreviewFailure => ({
  ok: false,
  status,
  code,
  error,
});

/** Verifies a preview token for `shop` and the exact `updates` about to be applied. Never throws on bad input. */
export function verifyPreviewToken(token: unknown, shop: string, updates: unknown, now = Date.now()): PreviewCheck {
  if (token === undefined || token === null || token === '') {
    return fail(428, 'preview_required', 'Preview the changes before applying them.');
  }
  const invalid = fail(400, 'preview_invalid', 'Invalid preview. Preview the changes again before applying them.');
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return invalid;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return invalid;
  const [payloadB64, sig] = parts;

  const expected = Buffer.from(sign(payloadB64));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return invalid;

  let p: any;
  try {
    p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return invalid;
  }
  if (
    !p ||
    p.v !== VERSION ||
    typeof p.shop !== 'string' ||
    typeof p.h !== 'string' ||
    !Number.isFinite(p.iat) ||
    !Number.isFinite(p.exp) ||
    p.iat > now + CLOCK_SKEW_MS ||
    p.exp - p.iat > PREVIEW_TTL_MS
  ) {
    return invalid;
  }
  if (p.shop !== shop) {
    return fail(403, 'preview_shop_mismatch', 'This preview belongs to a different store.');
  }
  if (now > p.exp) {
    return fail(409, 'preview_expired', 'The preview has expired. Preview the changes again before applying them.');
  }
  if (p.h !== hashUpdates(updates)) {
    return fail(409, 'preview_mismatch', 'The changes differ from what was previewed. Preview the changes again before applying them.');
  }
  return { ok: true, expiresAt: p.exp };
}
