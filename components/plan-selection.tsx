'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Crown, Loader2, X, Zap } from 'lucide-react';

export type PaidPlanKey = 'pro_monthly' | 'pro_annual';

export type BillingPlan = {
  key: PaidPlanKey;
  label: string;
  amount: number;
  currencyCode: string;
  interval: 'EVERY_30_DAYS' | 'ANNUAL';
  trialDays: number;
};

export type PlanInfo = {
  plan: 'free' | 'pro' | 'none';
  planName: string;
  productLimit: number | null; // null = unlimited
  hasActiveSubscription: boolean;
  requiresPlanSelection: boolean;
  freePlanEnabled: boolean;
  freeProductLimit: number;
  plans: BillingPlan[];
  subscription: {
    id: string;
    name: string;
    status: string;
    test: boolean;
    interval: string | null;
    currentPeriodEnd: string | null;
  } | null;
};

export type BillingNotice = 'accepted' | 'declined' | 'unknown' | null;

type Props = {
  planInfo: PlanInfo;
  busy: string | null; // key of the plan currently being processed
  notice: BillingNotice;
  error?: string;
  onChoosePaid: (key: PaidPlanKey) => void;
  onChooseFree: () => void;
  onClose?: () => void; // present when shown as a modal (merchant already has a plan)
  title?: string;
  subtitle?: string;
};

function price(p: BillingPlan) {
  const amount = p.amount.toFixed(2);
  const symbol = p.currencyCode === 'USD' ? '$' : `${p.currencyCode} `;
  return `${symbol}${amount}`;
}

export default function PlanSelection({
  planInfo,
  busy,
  notice,
  error,
  onChoosePaid,
  onChooseFree,
  onClose,
  title = 'Choose your plan',
  subtitle = 'Billing is handled securely by Shopify and appears on your Shopify invoice.',
}: Props) {
  const currentInterval = planInfo.subscription?.interval ?? null;
  const isCurrentFree = planInfo.plan === 'free';

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
            <Zap className="h-6 w-6" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        ) : null}
      </div>

      {notice === 'declined' ? (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The subscription was declined, so you were not charged. Choose a plan below to continue
            using the app.
          </span>
        </div>
      ) : null}
      {notice === 'accepted' ? (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Subscription approved. Thank you!</span>
        </div>
      ) : null}
      {error ? (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {planInfo.freePlanEnabled ? (
          <Card className="flex flex-col p-5 shadow-sm">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Free</h2>
              {isCurrentFree ? <Badge variant="secondary">Current</Badge> : null}
            </div>
            <p className="mb-4 text-3xl font-bold">$0</p>
            <ul className="mb-6 flex-1 space-y-2 text-sm text-muted-foreground">
              <li>Up to {planInfo.freeProductLimit} products per bulk operation</li>
              <li>Bulk vendor, price & inventory edits</li>
              <li>AI categories, descriptions, SEO & tags</li>
            </ul>
            <Button
              variant="outline"
              disabled={!!busy || isCurrentFree}
              onClick={onChooseFree}
            >
              {busy === 'free' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isCurrentFree
                ? 'Current plan'
                : planInfo.hasActiveSubscription
                  ? 'Downgrade to Free'
                  : 'Continue with Free'}
            </Button>
          </Card>
        ) : null}

        {planInfo.plans.map((p) => {
          const isCurrent = currentInterval === p.interval;
          const annual = p.interval === 'ANNUAL';
          return (
            <Card
              key={p.key}
              className={`flex flex-col p-5 shadow-sm ${annual ? 'border-primary ring-1 ring-primary' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 font-display text-lg font-semibold">
                  <Crown className="h-4 w-4 text-primary" /> {p.label}
                </h2>
                {isCurrent ? (
                  <Badge>Current</Badge>
                ) : annual ? (
                  <Badge variant="secondary">Best value</Badge>
                ) : null}
              </div>
              <p className="mb-4 text-3xl font-bold">
                {price(p)}
                <span className="text-base font-normal text-muted-foreground">
                  {annual ? ' / year' : ' / 30 days'}
                </span>
              </p>
              <ul className="mb-6 flex-1 space-y-2 text-sm text-muted-foreground">
                <li>Unlimited products per bulk operation</li>
                <li>All AI features</li>
                <li>Edit history, undo & restore</li>
                {p.trialDays > 0 ? <li>{p.trialDays}-day free trial</li> : null}
              </ul>
              <Button disabled={!!busy || isCurrent} onClick={() => onChoosePaid(p.key)}>
                {busy === p.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isCurrent ? 'Current plan' : `Choose ${p.label}`}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        You will be asked to approve the charge on Shopify. You can cancel or change plans at any
        time; uninstalling the app automatically cancels your subscription.
      </p>
    </div>
  );
}
