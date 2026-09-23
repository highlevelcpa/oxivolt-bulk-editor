import { NextRequest, NextResponse } from 'next/server';
import { API_KEY, API_SECRET, isValidShop, verifyOAuthHmac } from '@/lib/shopify';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Handles the OAuth callback: verifies HMAC + state, exchanges the code for an
// offline access token, persists it, then redirects into the embedded admin app.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shop = sp.get('shop');
  const code = sp.get('code');
  const state = sp.get('state');

  if (!isValidShop(shop)) {
    return new NextResponse('Invalid shop parameter', { status: 400 });
  }
  if (!verifyOAuthHmac(sp)) {
    return new NextResponse('HMAC validation failed', { status: 400 });
  }
  const cookieState = req.cookies.get('shopify_oauth_state')?.value;
  if (!state || !cookieState || state !== cookieState) {
    return new NextResponse('Invalid OAuth state', { status: 403 });
  }
  if (!code) {
    return new NextResponse('Missing authorization code', { status: 400 });
  }

  // Exchange the authorization code for an EXPIRING offline access token.
  // Shopify no longer accepts non-expiring tokens on the Admin API.
  let accessToken = '';
  let scope: string | null = null;
  let expiresIn = 0;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: API_KEY,
        client_secret: API_SECRET,
        code,
        expiring: 1,
      }),
      cache: 'no-store',
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text().catch(() => '');
      return new NextResponse(`Token exchange failed: ${text}`, { status: 502 });
    }
    const data = await tokenRes.json();
    accessToken = data?.access_token ?? '';
    scope = data?.scope ?? null;
    expiresIn = Number(data?.expires_in ?? 0);
  } catch (e: any) {
    return new NextResponse(`Token exchange error: ${e?.message ?? 'unknown'}`, { status: 502 });
  }

  if (!accessToken) {
    return new NextResponse('No access token returned', { status: 502 });
  }

  const tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;

  await prisma.shopSession.upsert({
    where: { shop },
    update: { accessToken, scope, tokenExpiresAt },
    create: { shop, accessToken, scope, tokenExpiresAt },
  });

  // Redirect into the embedded app inside the Shopify admin.
  const res = NextResponse.redirect(`https://${shop}/admin/apps/${API_KEY}`);
  res.cookies.delete('shopify_oauth_state');
  return res;
}
