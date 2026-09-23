import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken } from '@/lib/shopify';
import { getUsage } from '@/lib/usage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const usage = await getUsage(shop);
    return NextResponse.json({ shop, ...usage });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load usage' }, { status: 500 });
  }
}
