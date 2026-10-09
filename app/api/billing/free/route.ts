import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import {
  BillingError,
  cancelSubscription,
  fetchBillingState,
  FREE_PLAN_ENABLED,
  getPlanInfo,
  selectFreePlan,
} from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Selects the Free plan. If the merchant currently has an active Pro
// subscription it is cancelled through the Billing API (appSubscriptionCancel)
// first, so they are never charged for a plan they downgraded from.
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!FREE_PLAN_ENABLED) {
      return NextResponse.json(
        { error: 'free_plan_disabled', message: 'The Free plan is not available.' },
        { status: 400 },
      );
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

    const state = await fetchBillingState(shop, accessToken);
    if (state.active?.id) {
      await cancelSubscription(shop, accessToken, state.active.id);
      console.log('[billing] cancelled subscription on downgrade', shop, state.active.id);
    }
    await selectFreePlan(shop, state.installationId);

    const info = await getPlanInfo(shop, accessToken, { fresh: true });
    return NextResponse.json({ shop, ...info });
  } catch (e: any) {
    const code = e instanceof BillingError ? e.code : 'billing_error';
    console.error('[billing] free plan selection failed', e);
    return NextResponse.json(
      { error: code, message: e?.message ?? 'Failed to switch to the Free plan' },
      { status: 500 },
    );
  }
}
