import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken } from '@/lib/shopify';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await prisma.editLog.findMany({
      where: { shop },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const items = rows.map((r) => {
      const hasSnapshot = !!r.previousValues && r.previousValues !== '{}' && r.previousValues !== 'null';
      return {
        id: r.id,
        productId: r.productId,
        productTitle: r.productTitle,
        changes: r.changes,
        success: r.success,
        errorMsg: r.errorMsg,
        createdAt: r.createdAt,
        undone: r.undone,
        undoneAt: r.undoneAt,
        canUndo: r.success && !r.undone && hasSnapshot,
      };
    });

    return NextResponse.json({ shop, items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load history' }, { status: 500 });
  }
}
