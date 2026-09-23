import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

export const API_KEY = process.env.SHOPIFY_API_KEY ?? '';
export const API_SECRET = process.env.SHOPIFY_API_SECRET ?? '';
export const SCOPES =
  process.env.SHOPIFY_SCOPES ??
  'read_products,write_products,read_inventory,write_inventory,read_locations';
export const API_VERSION = '2025-07';

// ---------------------------------------------------------------------------
// URL / host helpers
// ---------------------------------------------------------------------------
export function getAppUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return `${proto}://${host}`;
}

// A valid myshopify domain, e.g. my-store.myshopify.com
export function isValidShop(shop: string | null | undefined): shop is string {
  if (!shop) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

// ---------------------------------------------------------------------------
// OAuth HMAC verification (query string from Shopify redirect)
// ---------------------------------------------------------------------------
export function verifyOAuthHmac(searchParams: URLSearchParams): boolean {
  try {
    const hmac = searchParams.get('hmac');
    if (!hmac) return false;
    const params: string[] = [];
    searchParams.forEach((value, key) => {
      if (key === 'hmac' || key === 'signature') return;
      params.push(`${key}=${value}`);
    });
    params.sort();
    const message = params.join('&');
    const digest = crypto.createHmac('sha256', API_SECRET).update(message).digest('hex');
    const a = Buffer.from(digest, 'utf-8');
    const b = Buffer.from(hmac, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session token (App Bridge idToken) verification -> returns shop domain
// ---------------------------------------------------------------------------
export function verifySessionToken(token: string | null | undefined): string | null {
  try {
    if (!token) return null;
    const payload = jwt.verify(token, API_SECRET, { algorithms: ['HS256'] }) as Record<string, any>;
    // aud must match our api key
    if (payload?.aud !== API_KEY) return null;
    const dest: string = payload?.dest ?? '';
    const shop = dest.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return isValidShop(shop) ? shop : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Webhook HMAC verification (raw body, base64 digest in X-Shopify-Hmac-Sha256)
// ---------------------------------------------------------------------------
export function verifyWebhookHmac(rawBody: string, hmacHeader: string | null): boolean {
  try {
    if (!hmacHeader) return false;
    const digest = crypto
      .createHmac('sha256', API_SECRET)
      .update(rawBody, 'utf8')
      .digest('base64');
    const a = Buffer.from(digest, 'utf-8');
    const b = Buffer.from(hmacHeader, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Extract Bearer token from request Authorization header.
export function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Admin GraphQL client
// ---------------------------------------------------------------------------
// Thrown when the Admin API rejects the access token (401/403), e.g. because a
// cached offline token was revoked when the merchant reinstalled the app.
export class ShopifyAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ShopifyAuthError';
    this.status = status;
  }
}

export async function shopifyGraphQL<T = any>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, any>,
): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new ShopifyAuthError(`Shopify API error ${res.status}: ${text}`, res.status);
    }
    throw new Error(`Shopify API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json?.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}
