// Shopify Billing API integration for OXIVOLT Bulk Editor.
//
// Pricing model:
//   - Free : 100 products per bulk operation (explicitly selected by the merchant)
//   - Pro  : $29.99 every 30 days, or $99.99 per year — unlimited products
//
// Flow (Shopify requirement 1.2.2 — accept, decline, re-approve on reinstall):
//   1. On every app load the client calls GET /api/subscription. If the shop has
//      no ACTIVE app subscription and has not explicitly chosen the Free plan
//      for the CURRENT installation, the app is gated behind a plan-selection
//      screen (`requiresPlanSelection: true`). Every protected API route enforces
//      the same rule server-side (see `requireActivePlan`).
//   2. Choosing Pro calls `appSubscriptionCreate` (GraphQL Billing API) and the
//      merchant is sent (top-level) to Shopify's `confirmationUrl` to approve.
//   3. Shopify redirects back to /api/billing/callback, which verifies the
//      subscription status with the Admin API (ACTIVE = accepted, anything else
//      = declined) and returns the merchant to the embedded app.
//   4. Shopify cancels app subscriptions on uninstall, and the app/uninstalled
//      webhook wipes our stored plan choice. The plan is ALWAYS read live from
//      `currentAppInstallation.activeSubscriptions`, never from a cached DB flag,
//      so after a reinstall the merchant must approve charges again.

import crypto from 'crypto';
import { API_SECRET, shopifyGraphQL } from './shopify';
import { prisma } from './db';

export const FREE_PRODUCT_LIMIT = 100;

// ---------------------------------------------------------------------------
// Configuration (all optional; sane defaults match the listed pricing)
// ---------------------------------------------------------------------------
function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// Set BILLING_FREE_PLAN_ENABLED=false to require a paid subscription for any use.
export const FREE_PLAN_ENABLED =
  String(process.env.BILLING_FREE_PLAN_ENABLED ?? 'true').toLowerCase() !== 'false';

export const TRIAL_DAYS = Math.floor(envNumber('BILLING_TRIAL_DAYS', 0));
export const CURRENCY = (process.env.BILLING_CURRENCY ?? 'USD').toUpperCase();

// BILLING_TEST_MODE: 'auto' (default: test charges only on development stores),
// 'true' (always test charges), 'false' (always real charges).
const TEST_MODE = String(process.env.BILLING_TEST_MODE ?? 'auto').toLowerCase();

export type PaidPlanKey = 'pro_monthly' | 'pro_annual';

export type PaidPlan = {
  key: PaidPlanKey;
  name: string; // shown to the merchant on Shopify's approval page
  label: string;
  amount: number;
  currencyCode: string;
  interval: 'EVERY_30_DAYS' | 'ANNUAL';
};

export const PAID_PLANS: Record<PaidPlanKey, PaidPlan> = {
  pro_monthly: {
    key: 'pro_monthly',
    name: 'OXIVOLT Pro (Monthly)',
    label: 'Pro Monthly',
    amount: envNumber('BILLING_PRO_MONTHLY_PRICE', 29.99),
    currencyCode: CURRENCY,
    interval: 'EVERY_30_DAYS',
  },
  pro_annual: {
    key: 'pro_annual',
    name: 'OXIVOLT Pro (Annual)',
    label: 'Pro Annual',
    amount: envNumber('BILLING_PRO_ANNUAL_PRICE', 99.99),
    currencyCode: CURRENCY,
    interval: 'ANNUAL',
  },
};

export function isPaidPlanKey(v: unknown): v is PaidPlanKey {
  return v === 'pro_monthly' || v === 'pro_annual';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ActiveSubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  interval: string | null;
  amount: string | null;
  currencyCode: string | null;
};

export type PlanInfo = {
  plan: 'free' | 'pro' | 'none';
  planName: string;
  productLimit: number | null; // null = unlimited
  hasActiveSubscription: boolean;
  requiresPlanSelection: boolean;
  freePlanEnabled: boolean;
  subscription: ActiveSubscription | null;
  plans: Array<PaidPlan & { trialDays: number }>;
  freeProductLimit: number;
};

export class BillingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Short-lived in-memory cache so every API call doesn't re-query Shopify.
// Invalidated whenever billing state changes (subscribe/cancel/callback/webhook).
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 15_000;
const planCache = new Map<string, { at: number; info: PlanInfo }>();

export function invalidatePlanCache(shop: string) {
  planCache.delete(shop);
}

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------
const BILLING_STATE_QUERY = `
  query BillingState {
    currentAppInstallation {
      id
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price { amount currencyCode }
              }
            }
          }
        }
      }
    }
  }
`;

const SHOP_PLAN_QUERY = `
  query ShopPlan {
    shop { plan { partnerDevelopment } }
  }
`;

const SUBSCRIPTION_CREATE_MUTATION = `
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $test: Boolean
    $trialDays: Int
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      test: $test
      trialDays: $trialDays
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const SUBSCRIPTION_CANCEL_MUTATION = `
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

const SUBSCRIPTION_NODE_QUERY = `
  query AppSubscriptionNode($id: ID!) {
    node(id: $id) {
      ... on AppSubscription { id name status test }
    }
  }
`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
function mapSubscription(s: any): ActiveSubscription {
  const pricing = (Array.isArray(s?.lineItems) ? s.lineItems : [])
    .map((li: any) => li?.plan?.pricingDetails)
    .find((p: any) => p?.__typename === 'AppRecurringPricing');
  return {
    id: String(s?.id ?? ''),
    name: String(s?.name ?? 'Pro'),
    status: String(s?.status ?? ''),
    test: Boolean(s?.test),
    trialDays: Number(s?.trialDays ?? 0),
    currentPeriodEnd: s?.currentPeriodEnd ?? null,
    interval: pricing?.interval ?? null,
    amount: pricing?.price?.amount != null ? String(pricing.price.amount) : null,
    currencyCode: pricing?.price?.currencyCode ?? null,
  };
}

// Live billing state straight from Shopify (source of truth).
export async function fetchBillingState(
  shop: string,
  accessToken: string,
): Promise<{ installationId: string | null; active: ActiveSubscription | null }> {
  const data: any = await shopifyGraphQL(shop, accessToken, BILLING_STATE_QUERY);
  const inst = data?.currentAppInstallation;
  const subs: any[] = Array.isArray(inst?.activeSubscriptions) ? inst.activeSubscriptions : [];
  const active = subs.find((s) => String(s?.status ?? '').toUpperCase() === 'ACTIVE');
  return {
    installationId: inst?.id ?? null,
    active: active ? mapSubscription(active) : null,
  };
}

function publicPlans(): PlanInfo['plans'] {
  return Object.values(PAID_PLANS).map((p) => ({ ...p, trialDays: TRIAL_DAYS }));
}

function buildPlanInfo(
  active: ActiveSubscription | null,
  freeSelected: boolean,
): PlanInfo {
  const base = {
    freePlanEnabled: FREE_PLAN_ENABLED,
    plans: publicPlans(),
    freeProductLimit: FREE_PRODUCT_LIMIT,
  };
  if (active) {
    return {
      ...base,
      plan: 'pro',
      planName: active.name || 'Pro',
      productLimit: null,
      hasActiveSubscription: true,
      requiresPlanSelection: false,
      subscription: active,
    };
  }
  if (FREE_PLAN_ENABLED && freeSelected) {
    return {
      ...base,
      plan: 'free',
      planName: 'Free',
      productLimit: FREE_PRODUCT_LIMIT,
      hasActiveSubscription: false,
      requiresPlanSelection: false,
      subscription: null,
    };
  }
  return {
    ...base,
    plan: 'none',
    planName: 'No plan',
    productLimit: 0,
    hasActiveSubscription: false,
    requiresPlanSelection: true,
    subscription: null,
  };
}

// The Free plan only counts if it was chosen during the CURRENT installation.
// After an uninstall the app/uninstalled webhook deletes the row; as a second
// safety net we also compare the stored installation id.
async function hasFreeSelection(shop: string, installationId: string | null): Promise<boolean> {
  const row = await prisma.shopBilling.findUnique({ where: { shop } }).catch(() => null);
  if (!row?.freePlanSelectedAt) return false;
  if (installationId && row.installationId && row.installationId !== installationId) return false;
  return true;
}

// Determines the merchant's entitlement. Throws BillingError('billing_check_failed')
// if Shopify cannot be reached and we have no safe fallback.
export async function getPlanInfo(
  shop: string,
  accessToken: string,
  opts: { fresh?: boolean } = {},
): Promise<PlanInfo> {
  const cached = planCache.get(shop);
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info;

  let state: Awaited<ReturnType<typeof fetchBillingState>>;
  try {
    state = await fetchBillingState(shop, accessToken);
  } catch (e: any) {
    console.error('[billing] failed to load billing state for', shop, e?.message);
    // Never grant Pro on error. Fall back to Free only if it was explicitly chosen.
    if (FREE_PLAN_ENABLED && (await hasFreeSelection(shop, null))) {
      return buildPlanInfo(null, true);
    }
    throw new BillingError('billing_check_failed', 'Could not verify your subscription. Please try again.');
  }

  const freeSelected = state.active ? false : await hasFreeSelection(shop, state.installationId);
  const info = buildPlanInfo(state.active, freeSelected);

  // Keep a local record in sync (informational only — never used to grant access).
  await prisma.shopBilling
    .upsert({
      where: { shop },
      update: {
        installationId: state.installationId ?? undefined,
        subscriptionId: state.active?.id ?? null,
        subscriptionStatus: state.active?.status ?? null,
      },
      create: {
        shop,
        installationId: state.installationId,
        subscriptionId: state.active?.id ?? null,
        subscriptionStatus: state.active?.status ?? null,
      },
    })
    .catch(() => null);

  planCache.set(shop, { at: Date.now(), info });
  return info;
}

async function shouldUseTestCharge(shop: string, accessToken: string): Promise<boolean> {
  if (TEST_MODE === 'true') return true;
  if (TEST_MODE === 'false') return false;
  try {
    const data: any = await shopifyGraphQL(shop, accessToken, SHOP_PLAN_QUERY);
    return Boolean(data?.shop?.plan?.partnerDevelopment);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signed return URL (so the callback can't be spoofed for arbitrary shops)
// ---------------------------------------------------------------------------
export function signShop(shop: string): string {
  return crypto.createHmac('sha256', API_SECRET).update(`billing:${shop}`).digest('hex');
}

export function verifyShopSignature(shop: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const a = Buffer.from(signShop(shop), 'utf-8');
  const b = Buffer.from(sig, 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function buildReturnUrl(appUrl: string, shop: string, planKey: PaidPlanKey): string {
  const qs = new URLSearchParams({ shop, plan: planKey, sig: signShop(shop) });
  return `${appUrl}/api/billing/callback?${qs.toString()}`;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
function userErrorsToBillingError(errors: any[]): BillingError {
  const msg = errors.map((e) => e?.message).filter(Boolean).join('; ') || 'Unknown billing error';
  if (/managed pricing/i.test(msg)) {
    return new BillingError(
      'managed_pricing_enabled',
      'This app is set to "Managed pricing" in the Shopify Partner Dashboard, which blocks the Billing API. ' +
        'Switch the app pricing to "Manual pricing" (Billing API) in Partner Dashboard → Apps → Distribution/Pricing.',
    );
  }
  return new BillingError('billing_api_error', msg);
}

// Creates a recurring app subscription and returns the URL where the merchant
// approves (or declines) the charge.
export async function createSubscription(
  shop: string,
  accessToken: string,
  planKey: PaidPlanKey,
  appUrl: string,
): Promise<{ confirmationUrl: string; subscriptionId: string | null; test: boolean }> {
  const plan = PAID_PLANS[planKey];
  const test = await shouldUseTestCharge(shop, accessToken);

  const variables: Record<string, any> = {
    name: plan.name,
    returnUrl: buildReturnUrl(appUrl, shop, planKey),
    test,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: plan.amount, currencyCode: plan.currencyCode },
            interval: plan.interval,
          },
        },
      },
    ],
  };
  if (TRIAL_DAYS > 0) variables.trialDays = TRIAL_DAYS;

  const data: any = await shopifyGraphQL(shop, accessToken, SUBSCRIPTION_CREATE_MUTATION, variables);
  const payload = data?.appSubscriptionCreate;
  const errors: any[] = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
  if (errors.length) throw userErrorsToBillingError(errors);
  if (!payload?.confirmationUrl) {
    throw new BillingError('billing_api_error', 'Shopify did not return a confirmation URL.');
  }

  const subscriptionId: string | null = payload?.appSubscription?.id ?? null;
  await prisma.shopBilling
    .upsert({
      where: { shop },
      update: { pendingSubscriptionId: subscriptionId, pendingPlan: planKey },
      create: { shop, pendingSubscriptionId: subscriptionId, pendingPlan: planKey },
    })
    .catch(() => null);

  return { confirmationUrl: payload.confirmationUrl, subscriptionId, test };
}

export async function cancelSubscription(shop: string, accessToken: string, subscriptionId: string) {
  const data: any = await shopifyGraphQL(shop, accessToken, SUBSCRIPTION_CANCEL_MUTATION, {
    id: subscriptionId,
  });
  const payload = data?.appSubscriptionCancel;
  const errors: any[] = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
  if (errors.length) throw userErrorsToBillingError(errors);
  invalidatePlanCache(shop);
  return payload?.appSubscription ?? null;
}

export async function getSubscriptionStatus(
  shop: string,
  accessToken: string,
  subscriptionId: string,
): Promise<string | null> {
  const data: any = await shopifyGraphQL(shop, accessToken, SUBSCRIPTION_NODE_QUERY, {
    id: subscriptionId,
  });
  return data?.node?.status ? String(data.node.status).toUpperCase() : null;
}

// Records that the merchant explicitly chose the Free plan for this installation.
export async function selectFreePlan(shop: string, installationId: string | null) {
  await prisma.shopBilling.upsert({
    where: { shop },
    update: { freePlanSelectedAt: new Date(), installationId: installationId ?? undefined },
    create: { shop, freePlanSelectedAt: new Date(), installationId },
  });
  invalidatePlanCache(shop);
}

// Wipes all billing state for a shop (uninstall / GDPR shop redact).
export async function clearBillingState(shop: string) {
  invalidatePlanCache(shop);
  await prisma.shopBilling.deleteMany({ where: { shop } }).catch(() => {});
}
