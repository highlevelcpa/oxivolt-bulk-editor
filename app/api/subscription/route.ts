import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { getPlanInfo } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Returns the current subscription plan + product limit for the calling shop.
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

    const info = await getPlanInfo(shop, accessToken);
    return NextResponse.json({ shop, ...info });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Failed to load subscription' },
      { status: 500 },
    );
  }
}
