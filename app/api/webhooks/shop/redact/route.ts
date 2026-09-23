import { NextRequest } from 'next/server';
import { handleComplianceWebhook } from '@/lib/webhooks';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GDPR: sent 48 hours after a shop uninstalls the app, requesting erasure of
// the shop's data. We remove the stored session and any audit logs for that shop.
export async function POST(req: NextRequest) {
  return handleComplianceWebhook(req, 'shop/redact', async (payload) => {
    const shop: string | undefined = payload?.shop_domain;
    if (!shop) return;
    await prisma.editLog.deleteMany({ where: { shop } }).catch(() => {});
    await prisma.shopSession.deleteMany({ where: { shop } }).catch(() => {});
    console.log('[gdpr] shop/redact completed for shop:', shop);
  });
}
