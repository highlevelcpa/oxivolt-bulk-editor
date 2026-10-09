import { NextRequest } from 'next/server';
import { handleComplianceWebhook } from '@/lib/webhooks';
import { prisma } from '@/lib/db';
import { clearBillingState } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Sent when a merchant uninstalls the app. Remove the stored offline access token
// so a future re-install triggers a fresh OAuth grant.
export async function POST(req: NextRequest) {
  return handleComplianceWebhook(req, 'app/uninstalled', async (payload) => {
    const shop: string | undefined = payload?.myshopify_domain ?? payload?.shop_domain;
    if (!shop) return;
    await prisma.shopSession.deleteMany({ where: { shop } }).catch(() => {});
    // Shopify cancels the app subscription on uninstall; wipe our plan choice too
    // so a reinstall must select a plan / approve charges again.
    await clearBillingState(shop);
    console.log('[app] uninstalled, session + billing state removed for shop:', shop);
  });
}
