// Obtains a valid (expiring) Shopify offline access token for a shop using the
// OAuth token-exchange grant. Embedded apps always have a fresh App Bridge
// session token (idToken) available on each request, so instead of juggling
// refresh tokens we simply exchange the session token for a fresh offline
// token whenever the cached one is missing or about to expire.
//
// Shopify no longer accepts non-expiring offline tokens on the Admin API, so
// we always request an expiring token (expiring=1).

import { API_KEY, API_SECRET, SCOPES, shopifyGraphQL, ShopifyAuthError } from './shopify';
import { prisma } from './db';

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ID_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';
const OFFLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token';

// Thrown when the merchant must (re)authorize the app (e.g. new scopes needed).
export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

export async function exchangeSessionToken(
  shop: string,
  sessionToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    client_id: API_KEY,
    client_secret: API_SECRET,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: sessionToken,
    subject_token_type: ID_TOKEN_TYPE,
    requested_token_type: OFFLINE_TOKEN_TYPE,
    expiring: '1',
  });

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    cache: 'no-store',
  });

  const text = await res.text().catch(() => '');
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    // A 400 with invalid_subject_token / a 403 typically means the app needs a
    // fresh authorization (e.g. newly requested scopes not yet granted).
    const errCode = String(data?.error ?? '');
    if (res.status === 400 || res.status === 403 || errCode.includes('scope')) {
      throw new ReauthRequiredError(`Reauthorization required: ${res.status} ${text}`);
    }
    throw new Error(`Token exchange failed ${res.status}: ${text}`);
  }

  const accessToken: string = data?.access_token ?? '';
  const expiresIn = Number(data?.expires_in ?? 3600);
  if (!accessToken) {
    throw new Error('Token exchange returned no access_token');
  }
  return { accessToken, expiresIn };
}

// Returns a valid offline access token for the shop, exchanging the current
// session token when the cached one is missing or within 2 minutes of expiry.
export async function getShopAccessToken(
  shop: string,
  sessionToken: string,
  forceRefresh = false,
): Promise<string> {
  const now = Date.now();
  const existing = await prisma.shopSession.findUnique({ where: { shop } }).catch(() => null);

  if (
    !forceRefresh &&
    existing?.accessToken &&
    existing.tokenExpiresAt &&
    existing.tokenExpiresAt.getTime() > now + 120_000
  ) {
    return existing.accessToken;
  }

  const { accessToken, expiresIn } = await exchangeSessionToken(shop, sessionToken);
  const tokenExpiresAt = new Date(now + expiresIn * 1000);

  await prisma.shopSession
    .upsert({
      where: { shop },
      update: { accessToken, tokenExpiresAt, scope: SCOPES },
      create: { shop, accessToken, tokenExpiresAt, scope: SCOPES },
    })
    .catch(() => null);

  return accessToken;
}

// A tiny query used only to confirm the access token is currently valid.
const TOKEN_PROBE_QUERY = `{ shop { id } }`;

// Returns an access token that is verified to work against the Admin API right
// now. A cached offline token can be silently revoked by Shopify (e.g. when the
// merchant uninstalls + reinstalls the app), in which case the cached value is
// still "unexpired" in our DB but the API rejects it with 401. Here we probe the
// cached token and, if it was revoked, force a fresh token exchange and probe
// again. If it still fails, the merchant must (re)authorize the app.
export async function getWorkingAccessToken(shop: string, sessionToken: string): Promise<string> {
  let accessToken = await getShopAccessToken(shop, sessionToken, false);
  try {
    await shopifyGraphQL(shop, accessToken, TOKEN_PROBE_QUERY);
    return accessToken;
  } catch (e: any) {
    if (!(e instanceof ShopifyAuthError)) throw e;
  }

  // Cached token was rejected -> force a brand new exchange and validate it.
  accessToken = await getShopAccessToken(shop, sessionToken, true);
  try {
    await shopifyGraphQL(shop, accessToken, TOKEN_PROBE_QUERY);
    return accessToken;
  } catch (e: any) {
    if (e instanceof ShopifyAuthError) {
      throw new ReauthRequiredError('Access token invalid after refresh; reauthorization required.');
    }
    throw e;
  }
}
