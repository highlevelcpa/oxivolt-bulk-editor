// Server-side billing gate used by every protected API route (middleware-style).
// Blocks the request with 402 when the shop has neither an ACTIVE Shopify app
// subscription nor an explicit Free-plan choice for the current installation.

import { NextResponse } from 'next/server';
import { BillingError, getPlanInfo, PlanInfo } from './billing';

export type BillingGuardResult =
  | { ok: true; planInfo: PlanInfo }
  | { ok: false; response: NextResponse };

export async function requireActivePlan(
  shop: string,
  accessToken: string,
): Promise<BillingGuardResult> {
  let planInfo: PlanInfo;
  try {
    planInfo = await getPlanInfo(shop, accessToken);
  } catch (e: any) {
    const code = e instanceof BillingError ? e.code : 'billing_check_failed';
    return {
      ok: false,
      response: NextResponse.json(
        { error: code, message: e?.message ?? 'Could not verify your subscription.' },
        { status: 503 },
      ),
    };
  }

  if (planInfo.requiresPlanSelection) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'billing_required',
          message: 'Please choose a plan to continue using OXIVOLT Bulk Editor.',
          requiresPlanSelection: true,
        },
        { status: 402 },
      ),
    };
  }
  return { ok: true, planInfo };
}

// Standard 402 body when a request exceeds the plan's per-operation product limit.
export function limitExceededResponse(planInfo: PlanInfo, verb: string) {
  return NextResponse.json(
    {
      error: 'limit_exceeded',
      message: `Your ${planInfo.planName} plan allows ${verb} up to ${planInfo.productLimit} products at a time. Upgrade to Pro for unlimited.`,
      productLimit: planInfo.productLimit,
    },
    { status: 402 },
  );
}
