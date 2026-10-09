import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { BillingError, getPlanInfo } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Returns the live billing state for the calling shop. `requiresPlanSelection`
// tells the client to show the plan-selection gate (first install, reinstall,
// declined charge, or cancelled subscription).
export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    const fresh = req.nextUrl.searchParams.get('fresh') === '1';
    const info = await getPlanInfo(shop, accessToken, { fresh });
    return NextResponse.json({ shop, ...info });
  } catch (e: any) {
    const code = e instanceof BillingError ? e.code : undefined;
    return NextResponse.json(
      { error: code ?? e?.message ?? 'Failed to load subscription', message: e?.message },
      { status: code ? 503 : 500 },
    );
  }
}
