import { NextRequest } from 'next/server';
import { handleComplianceWebhook } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

// GDPR: a store owner / customer requests the data this app holds about a customer.
// OXIVOLT Bulk Editor only reads and edits PRODUCT data. It never stores or
// processes any customer personal data, so there is nothing to return here.
export async function POST(req: NextRequest) {
  return handleComplianceWebhook(req, 'customers/data_request', (payload) => {
    console.log('[gdpr] customers/data_request received for shop:', payload?.shop_domain);
  });
}
