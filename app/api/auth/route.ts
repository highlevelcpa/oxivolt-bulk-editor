import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { API_KEY, SCOPES, isValidShop, getAppUrl } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

// Starts the Shopify OAuth grant flow (top-level redirect to the merchant's shop).
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get('shop');
  if (!isValidShop(shop)) {
    return new NextResponse('Invalid or missing shop parameter', { status: 400 });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const appUrl = getAppUrl(req);
  const redirectUri = `${appUrl}/api/auth/callback`;

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(API_KEY)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('shopify_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return res;
}
