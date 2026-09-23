import { NextRequest, NextResponse } from 'next/server';

// Sets the Content-Security-Policy frame-ancestors header so the app can be embedded
// inside the Shopify admin. Only applied when a shop context is present, so the normal
// preview (no shop param) is never frame-blocked.
export function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const shop = req.nextUrl.searchParams.get('shop');
  if (shop && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    res.headers.set(
      'Content-Security-Policy',
      `frame-ancestors https://${shop} https://admin.shopify.com;`,
    );
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg|og-image.png).*)'],
};
