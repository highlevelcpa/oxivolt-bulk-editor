import { NextRequest } from 'next/server';
import { handleComplianceWebhook } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';

// GDPR: request to erase a customer's personal data.
// OXIVOLT Bulk Editor stores no customer personal data, so there is nothing to erase.
export async function POST(req: NextRequest) {
  return handleComplianceWebhook(req, 'customers/redact', (payload) => {
    console.log('[gdpr] customers/redact received for shop:', payload?.shop_domain);
  });
}
