// Subscription / plan helpers for OXIVOLT Bulk Editor.
//
// Pricing model (Shopify managed pricing):
//   - Free : 100 products per bulk operation (no active subscription)
//   - Pro  : $29.99/mo or $99.99/yr, unlimited products (any active subscription)
//
// We treat ANY active subscription as the paid (unlimited) tier, so the code
// keeps working even if the plan is renamed in the Partner dashboard.

import { shopifyGraphQL } from './shopify';

export const FREE_PRODUCT_LIMIT = 100;
export const FALLBACK_APP_HANDLE = 'oxivolt-bulk-editor';

export type PlanInfo = {
  plan: 'free' | 'pro';
  planName: string;
  productLimit: number | null; // null = unlimited
  appHandle: string;
  upgradeUrl: string;
};

const PLAN_QUERY = `
  query {
    currentAppInstallation {
      app { handle }
      activeSubscriptions { name status }
    }
  }
`;

function storeHandle(shop: string): string {
  return (shop ?? '').replace(/\.myshopify\.com$/i, '');
}

export function buildUpgradeUrl(shop: string, appHandle: string): string {
  return `https://admin.shopify.com/store/${storeHandle(shop)}/charges/${appHandle}/pricing_plans`;
}

// Determines the current plan for a shop. Falls back to the free tier if the
// billing query fails, so the app never hard-blocks on a transient API error.
export async function getPlanInfo(shop: string, accessToken: string): Promise<PlanInfo> {
  let appHandle = FALLBACK_APP_HANDLE;
  let isPaid = false;
  let planName = 'Free';

  try {
    const data: any = await shopifyGraphQL(shop, accessToken, PLAN_QUERY);
    const inst = data?.currentAppInstallation;
    if (inst?.app?.handle) appHandle = inst.app.handle;
    const subs: any[] = Array.isArray(inst?.activeSubscriptions) ? inst.activeSubscriptions : [];
    const active = subs.find((s) => String(s?.status ?? '').toUpperCase() === 'ACTIVE');
    if (active) {
      isPaid = true;
      planName = active?.name || 'Pro';
    }
  } catch {
    // keep free-tier defaults on error
  }

  return {
    plan: isPaid ? 'pro' : 'free',
    planName,
    productLimit: isPaid ? null : FREE_PRODUCT_LIMIT,
    appHandle,
    upgradeUrl: buildUpgradeUrl(shop, appHandle),
  };
}
