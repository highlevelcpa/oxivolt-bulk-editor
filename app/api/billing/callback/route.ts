import { NextRequest, NextResponse } from 'next/server';
import { API_KEY, isValidShop } from '@/lib/shopify';
import { prisma } from '@/lib/db';
import { getSubscriptionStatus, invalidatePlanCache, verifyShopSignature } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Shopify sends the merchant here (top-level) after they approve or decline the
// charge on the confirmation page, appending `charge_id`. We verify the real
// status with the Admin API — never trusting the query string — then send the
// merchant back into the embedded app with ?billing=accepted|declined.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const shop = sp.get('shop');
  const chargeId = sp.get('charge_id');

  if (!isValidShop(shop) || !verifyShopSignature(shop, sp.get('sig'))) {
    return new NextResponse('Invalid billing callback', { status: 400 });
  }

  invalidatePlanCache(shop);

  let result: 'accepted' | 'declined' | 'unknown' = chargeId ? 'unknown' : 'declined';
  let status: string | null = null;

  if (chargeId && /^\d+$/.test(chargeId)) {
    const session = await prisma.shopSession.findUnique({ where: { shop } }).catch(() => null);
    if (session?.accessToken) {
      try {
        status = await getSubscriptionStatus(
          shop,
          session.accessToken,
          `gid://shopify/AppSubscription/${chargeId}`,
        );
        result = status === 'ACTIVE' ? 'accepted' : 'declined';
      } catch (e: any) {
        // Token may have expired; the embedded app re-checks live on load anyway.
        console.warn('[billing] callback could not verify charge', shop, chargeId, e?.message);
      }
    }
  }

  await prisma.shopBilling
    .upsert({
      where: { shop },
      update: {
        lastChargeResult: result,
        lastChargeAt: new Date(),
        pendingSubscriptionId: null,
        ...(status ? { subscriptionStatus: status } : {}),
        ...(result === 'accepted' && chargeId
          ? { subscriptionId: `gid://shopify/AppSubscription/${chargeId}` }
          : {}),
      },
      create: { shop, lastChargeResult: result, lastChargeAt: new Date() },
    })
    .catch(() => null);

  console.log('[billing] callback', shop, 'charge_id=', chargeId, 'status=', status, 'result=', result);
  // Only whitelisted in-app paths are allowed as a return target.
  const path = sp.get('return') === 'manage-plan' ? '/manage-plan' : '';
  return NextResponse.redirect(`https://${shop}/admin/apps/${API_KEY}${path}?billing=${result}`);
}
