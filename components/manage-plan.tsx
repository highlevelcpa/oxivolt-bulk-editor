'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/client-api';
import { appHref } from '@/components/app-nav';
import PlanSelection, { type BillingNotice, type PaidPlanKey, type PlanInfo } from '@/components/plan-selection';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowLeft, Boxes, CalendarClock, Crown, Loader2, RefreshCw } from 'lucide-react';

// Opens a URL in the top window (outside the Shopify admin iframe). Shopify's
// charge approval page refuses to render inside an iframe.
function openTopLevel(url: string) {
  try {
    if (window.open(url, '_top')) return;
    if (window.top) window.top.location.href = url;
    else window.location.href = url;
  } catch {
    window.open(url, '_blank');
  }
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function describeBilling(info: PlanInfo): string {
  if (info.plan === 'free') return 'Free — no charge';
  if (info.plan === 'none') return 'No plan selected';
  const plan = info.plans.find((p) => p.interval === info.subscription?.interval);
  if (!plan) return info.subscription?.name ?? 'Paid plan';
  const symbol = plan.currencyCode === 'USD' ? '$' : `${plan.currencyCode} `;
  return `${symbol}${plan.amount.toFixed(2)} ${plan.interval === 'ANNUAL' ? 'per year' : 'every 30 days'}`;
}

export default function ManagePlan({ shop, host }: { shop: string; host: string }) {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<BillingNotice>(null);
  const [usageCount, setUsageCount] = useState<number | null>(null);

  const loadPlan = useCallback(async (fresh: boolean): Promise<PlanInfo | null> => {
    setLoadError('');
    try {
      const res = await authFetch(`/api/subscription${fresh ? '?fresh=1' : ''}`, { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data?.error === 'reauth_required') {
        openTopLevel(`/api/auth?shop=${encodeURIComponent(shop)}`);
        return null;
      }
      if (!res.ok || !data?.plan) {
        setLoadError(data?.message ?? 'Could not load your plan. Please try again.');
        return null;
      }
      setPlanInfo(data as PlanInfo);
      return data as PlanInfo;
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load your plan. Please try again.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    let cancelled = false;
    // The billing callback returns here with ?billing=accepted|declined|unknown.
    const param = new URLSearchParams(window.location.search).get('billing');
    const billing: BillingNotice =
      param === 'accepted' || param === 'declined' || param === 'unknown' ? param : null;

    (async () => {
      const info = await loadPlan(true);
      if (cancelled) return;
      setNotice(billing);
      if (billing === 'accepted' || (billing === 'unknown' && info?.hasActiveSubscription)) {
        toast.success(`Subscription approved — you are on ${info?.planName ?? 'Pro'}.`);
      }
      try {
        const res = await authFetch('/api/usage', { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && typeof data?.count === 'number') setUsageCount(data.count);
      } catch {
        // usage is informational only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlan]);

  const choosePaid = useCallback(async (key: PaidPlanKey) => {
    setBusy(key);
    setError('');
    try {
      const res = await authFetch('/api/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify({ plan: key, returnTo: 'manage-plan' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.confirmationUrl) {
        setError(data?.message ?? 'Could not start the subscription. Please try again.');
        setBusy(null);
        return;
      }
      openTopLevel(data.confirmationUrl); // keep spinner while navigating away
    } catch (e: any) {
      setError(e?.message ?? 'Could not start the subscription. Please try again.');
      setBusy(null);
    }
  }, []);

  const chooseFree = useCallback(async () => {
    setBusy('free');
    setError('');
    try {
      const res = await authFetch('/api/billing/free', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.plan) {
        setError(data?.message ?? 'Could not switch to the Free plan.');
        return;
      }
      setPlanInfo(data as PlanInfo);
      setNotice(null);
      toast.success('You are on the Free plan.');
    } catch (e: any) {
      setError(e?.message ?? 'Could not switch to the Free plan.');
    } finally {
      setBusy(null);
    }
  }, []);

  const editorHref = appHref('/', shop, host);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!planInfo) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-foreground">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="max-w-md text-sm text-muted-foreground">{loadError || 'Could not load your plan.'}</p>
        <Button
          onClick={() => {
            setLoading(true);
            loadPlan(true);
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </main>
    );
  }

  const renews = formatDate(planInfo.subscription?.currentPeriodEnd);
  const isPaid = planInfo.plan === 'pro';
  const statusLabel = isPaid
    ? (planInfo.subscription?.status ?? 'ACTIVE')
    : planInfo.plan === 'free'
      ? 'ACTIVE'
      : 'NOT SELECTED';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[960px] px-4 pt-6 sm:px-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-1.5 px-2">
            <a href={editorHref}>
              <ArrowLeft className="h-4 w-4" /> Back to editor
            </a>
          </Button>
          <span className="truncate text-xs text-muted-foreground">{shop}</span>
        </div>

        <Card className="p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current plan</p>
              <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold">
                <Crown className="h-5 w-5 text-primary" />
                {planInfo.plan === 'none' ? 'No plan yet' : planInfo.planName}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{describeBilling(planInfo)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusLabel === 'ACTIVE' ? 'default' : 'secondary'}>{statusLabel}</Badge>
              {planInfo.subscription?.test ? <Badge variant="outline">Test charge</Badge> : null}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Products per operation</p>
              <p className="mt-1 font-semibold">
                {planInfo.plan === 'none'
                  ? '—'
                  : planInfo.productLimit === null
                    ? 'Unlimited'
                    : `Up to ${planInfo.productLimit}`}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> {isPaid ? 'Next billing date' : 'Billing'}
              </p>
              <p className="mt-1 font-semibold">{isPaid ? (renews ?? 'Managed by Shopify') : 'No recurring charge'}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Boxes className="h-3.5 w-3.5" /> Processed this month
              </p>
              <p className="mt-1 font-semibold">{usageCount ?? '—'}</p>
            </div>
          </div>
        </Card>
      </div>

      <PlanSelection
        planInfo={planInfo}
        busy={busy}
        notice={notice}
        error={error}
        onChoosePaid={choosePaid}
        onChooseFree={chooseFree}
        title={planInfo.requiresPlanSelection ? 'Choose your plan' : 'Change plan'}
        subtitle="Upgrade, downgrade or switch billing cycle. Charges are approved and billed through Shopify."
      />
    </main>
  );
}
