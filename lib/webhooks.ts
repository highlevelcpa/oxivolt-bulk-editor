import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';

// Shared handler for Shopify mandatory GDPR/compliance webhooks.
// Verifies the HMAC signature on the raw body and returns 401 when invalid,
// 200 when valid. Shopify requires all three compliance topics to behave this way.
export async function handleComplianceWebhook(
  req: NextRequest,
  topic: string,
  onValid?: (payload: any) => Promise<void> | void,
): Promise<NextResponse> {
  const rawBody = await req.text();
  const hmac = req.headers.get('x-shopify-hmac-sha256');

  if (!verifyWebhookHmac(rawBody, hmac)) {
    return new NextResponse('Unauthorized: invalid HMAC', { status: 401 });
  }

  let payload: any = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }

  try {
    if (onValid) await onValid(payload);
  } catch (e) {
    // Never fail the webhook because of downstream work; log and still ack.
    console.error(`[webhook:${topic}] handler error`, e);
  }

  return new NextResponse(null, { status: 200 });
}
