import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl, getBearerToken, verifySessionToken } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import {
  BillingError,
  createSubscription,
  getPlanInfo,
  invalidatePlanCache,
  isBillingReturnTo,
  isPaidPlanKey,
  PAID_PLANS,
} from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Creates a Shopify app subscription via the Billing API (appSubscriptionCreate)
// and returns the confirmationUrl. The client must open it at the top level so
// the merchant can approve or decline the charge on Shopify's page.
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const planKey = body?.plan;
    if (!isPaidPlanKey(planKey)) {
      return NextResponse.json({ error: 'invalid_plan', message: 'Unknown plan.' }, { status: 400 });
    }

    let accessToken: string;
    try {
      accessToken = await getWorkingAccessToken(shop, token);
    } catch (e: any) {
      if (e instanceof ReauthRequiredError) {
        return NextResponse.json({ error: 'reauth_required' }, { status: 401 });
      }
      throw e;
    }

    // Don't create a duplicate charge for the plan the merchant already has.
    const current = await getPlanInfo(shop, accessToken, { fresh: true }).catch(() => null);
    if (current?.subscription && current.subscription.interval === PAID_PLANS[planKey].interval) {
      return NextResponse.json(
        { error: 'already_subscribed', message: `You are already on ${current.planName}.` },
        { status: 409 },
      );
    }

    const returnTo = isBillingReturnTo(body?.returnTo) ? body.returnTo : 'editor';
    const result = await createSubscription(shop, accessToken, planKey, getAppUrl(req), returnTo);
    invalidatePlanCache(shop);
    console.log('[billing] subscription created', shop, planKey, result.subscriptionId, 'test=', result.test);
    return NextResponse.json({ confirmationUrl: result.confirmationUrl, test: result.test });
  } catch (e: any) {
    if (e instanceof BillingError) {
      console.error('[billing] subscribe failed', e.code, e.message);
      return NextResponse.json({ error: e.code, message: e.message }, { status: 400 });
    }
    console.error('[billing] subscribe error', e);
    return NextResponse.json(
      { error: 'billing_error', message: e?.message ?? 'Failed to start subscription' },
      { status: 500 },
    );
  }
}
