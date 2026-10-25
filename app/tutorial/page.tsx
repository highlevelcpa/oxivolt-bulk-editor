import Link from 'next/link';
import { ExternalLink, PlayCircle } from 'lucide-react';
import { ResourceShell, resourceMetadata, Callout, Kbd, YOUTUBE_ID } from '@/components/resources/resource-shell';

export const metadata = resourceMetadata(
  'Video Tutorial',
  'Watch the 2-minute OXIVOLT Bulk Editor tutorial: select products, bulk edit vendor, price and inventory, preview changes and apply them to your Shopify store.',
);

const WATCH_URL = `https://www.youtube.com/watch?v=${YOUTUBE_ID}`;

// Chapters verified against the published video (duration 1:54).
const CHAPTERS: { start: number; label: string; text: string }[] = [
  { start: 0, label: '0:00', text: 'Introduction — bulk edit your Shopify products in seconds' },
  { start: 13, label: '0:13', text: 'The problem — editing products one by one wastes hours' },
  { start: 25, label: '0:25', text: 'Step 1 — Select products with checkboxes or Select all' },
  { start: 35, label: '0:35', text: 'Step 2 — Bulk edit vendor, price and inventory' },
  { start: 47, label: '0:47', text: 'Step 3 — Preview changes and confirm' },
  { start: 59, label: '0:59', text: 'Overview — one dashboard for your catalog' },
  { start: 68, label: '1:08', text: 'Pricing — Free and Pro plans' },
  { start: 87, label: '1:27', text: 'Benefits and getting started' },
];

const STEPS: { title: string; at: number; body: React.ReactNode }[] = [
  {
    title: 'Select the products to edit',
    at: 25,
    body: (
      <>
        <p>
          Open the app from <strong>Apps</strong> in your Shopify admin. Tick the checkbox next to each product you want
          to change, or use <Kbd>Select all</Kbd>. Use the status filter or search box first to narrow the list.
        </p>
      </>
    ),
  },
  {
    title: 'Configure the bulk edit',
    at: 35,
    body: (
      <>
        <p>In the <strong>Bulk edit</strong> panel, enable only the fields you want to change. In the video:</p>
        <ul className="mt-2 list-disc space-y-1 pl-6">
          <li><strong>Vendor</strong> is set to <Kbd>OXIVOLT</Kbd>.</li>
          <li><strong>Price</strong> uses <Kbd>Multiply</Kbd> with a factor of <Kbd>0.7</Kbd> (a 30% decrease). Use <Kbd>Fixed</Kbd> to set one price for all.</li>
          <li><strong>Inventory quantity</strong> is set to <Kbd>100</Kbd> (an absolute quantity, not an increase).</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Preview and apply',
    at: 47,
    body: (
      <p>
        Click <Kbd>Preview changes</Kbd> to compare current and new values side by side. If everything looks right,
        click <Kbd>Confirm &amp; apply</Kbd>. A progress bar runs while products are updated, followed by a summary
        message.
      </p>
    ),
  },
];

export default function TutorialPage() {
  return (
    <ResourceShell
      current="tutorial"
      eyebrow="Video Tutorial"
      title="Bulk edit Shopify products in under 2 minutes"
      intro={
        <p>
          This short walkthrough shows the core workflow of OXIVOLT Bulk Editor: select products, choose what to change,
          preview the result and apply it to your store.
        </p>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-10">
          <div>
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black shadow-lg">
              <iframe
                className="absolute inset-0 h-full w-full"
                src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?rel=0`}
                title="OXIVOLT Bulk Editor — Edit Shopify Products in Bulk in Seconds"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
            <a
              href={WATCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Watch on YouTube <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">What this tutorial covers</h2>
            <ul className="list-disc space-y-1 pl-6 leading-relaxed text-foreground/90">
              <li>Selecting products individually or all at once</li>
              <li>Bulk editing vendor, price (multiply or fixed) and inventory quantity</li>
              <li>Reviewing changes in the preview before applying them</li>
              <li>The Free and Pro plans</li>
            </ul>
          </section>

          <section className="space-y-5">
            <h2 className="font-display text-2xl font-bold tracking-tight">Step-by-step walkthrough</h2>
            <ol className="space-y-5">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4 rounded-xl border border-border bg-card p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 space-y-2 leading-relaxed text-foreground/90">
                    <h3 className="font-display text-lg font-semibold text-foreground">{step.title}</h3>
                    {step.body}
                    <a
                      href={`${WATCH_URL}&t=${step.at}s`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      <PlayCircle className="h-4 w-4" aria-hidden="true" /> See it in the video
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <Callout title="Not shown in the video">
            <p>
              The app also includes AI tools (titles, descriptions, SEO &amp; URL handle, tags and product category),
              <strong> Edit history</strong> with one-click <strong>Restore</strong>, and <strong>Export CSV</strong>.
              These are explained in the{' '}
              <Link href="/docs#ai-tools" className="font-medium text-primary hover:underline">User Guide</Link>.
            </p>
          </Callout>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">Plans mentioned in the video</h2>
            <p className="leading-relaxed text-foreground/90">
              <strong>Free</strong> ($0) lets you edit up to 100 products per bulk operation. <strong>Pro</strong> costs
              $29.99 per month or $99.99 per year and removes the product limit. Billing is handled by Shopify. See the{' '}
              <Link href="/faq#plans" className="text-primary hover:underline">plans FAQ</Link> for details.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">Troubleshooting</h2>
            <ul className="list-disc space-y-2 pl-6 leading-relaxed text-foreground/90">
              <li>
                <strong>The video does not play.</strong> Some browsers or networks block embedded YouTube videos. Use the{' '}
                <a href={WATCH_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Watch on YouTube
                </a>{' '}
                link instead.
              </li>
              <li>
                <strong>Preview or Apply does nothing.</strong> Make sure at least one product is selected and at least one
                field checkbox (Vendor, Price or Inventory quantity) is enabled.
              </li>
              <li>
                <strong>An upgrade prompt appears.</strong> The Free plan allows up to 100 products per operation. Select
                fewer products or upgrade to Pro.
              </li>
              <li>
                <strong>Prices changed more than expected.</strong> Check the multiplier: <Kbd>0.7</Kbd> means 70% of the
                current price. Use <Kbd>History</Kbd> &rarr; <Kbd>Restore</Kbd> to revert a product.
              </li>
              <li>
                <strong>Inventory did not change on every variant.</strong> Price and inventory edits apply to the first
                variant at the first active location.
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              More answers in the <Link href="/docs#troubleshooting" className="text-primary hover:underline">User Guide</Link>{' '}
              and <Link href="/faq" className="text-primary hover:underline">FAQ</Link>.
            </p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-semibold">Video chapters</h2>
            <ol className="mt-3 space-y-1">
              {CHAPTERS.map((c) => (
                <li key={c.start}>
                  <a
                    href={`${WATCH_URL}&t=${c.start}s`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-secondary"
                  >
                    <span className="w-10 shrink-0 font-mono text-xs leading-5 text-primary">{c.label}</span>
                    <span className="text-muted-foreground">{c.text}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </ResourceShell>
  );
}
