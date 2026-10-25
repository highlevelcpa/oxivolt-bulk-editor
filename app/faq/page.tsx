import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { ResourceShell, resourceMetadata, SUPPORT_EMAIL } from '@/components/resources/resource-shell';

export const metadata = resourceMetadata(
  'FAQ',
  'Answers to common questions about OXIVOLT Bulk Editor: getting started, bulk editing vendor, price and inventory, AI content tools, history and restore, plans, permissions and privacy.',
);

type QA = { q: string; a: React.ReactNode };

const link = 'font-medium text-primary hover:underline';

const CATEGORIES: { id: string; title: string; items: QA[] }[] = [
  {
    id: 'general',
    title: 'General',
    items: [
      {
        q: 'What is OXIVOLT Bulk Editor?',
        a: 'A Shopify app that lets you update many products at once: vendor, price and inventory quantity, plus AI-generated titles, descriptions, SEO fields, tags and product categories. It runs inside your Shopify admin.',
      },
      {
        q: 'Who is it for?',
        a: 'Shopify merchants and store managers who need to change many products quickly — for example applying a sale discount, updating a supplier name, resetting stock levels or improving product content and SEO across the catalog.',
      },
      {
        q: 'Who makes the app?',
        a: 'OXIVOLT Bulk Editor is operated by HIGH LEVEL CPA LLC.',
      },
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting started',
    items: [
      {
        q: 'How do I install the app?',
        a: (
          <>
            Install it from the Shopify App Store, or enter your store domain (your-store.myshopify.com) on the{' '}
            <Link href="/" className={link}>app home page</Link> and click Install. Approve the permissions in Shopify,
            then open the app from Apps in your Shopify admin.
          </>
        ),
      },
      {
        q: 'What happens the first time I open the app?',
        a: 'You are asked to choose a plan (Free, Pro Monthly or Pro Annual). After that your products load automatically.',
      },
      {
        q: 'Is there a video walkthrough?',
        a: (
          <>
            Yes — see the <Link href="/tutorial" className={link}>2-minute video tutorial</Link>. The full{' '}
            <Link href="/docs" className={link}>User Guide</Link> covers every feature.
          </>
        ),
      },
    ],
  },
  {
    id: 'bulk-editing',
    title: 'Selecting & bulk editing',
    items: [
      {
        q: 'How do I select products?',
        a: 'Tick the checkbox next to each product, or use Select all to select every product matching the current status filter and search. The badge shows how many are selected.',
      },
      {
        q: 'Which fields can I bulk edit?',
        a: 'Vendor, price and inventory quantity. Each field has its own checkbox, and only enabled fields are changed. The AI tools can additionally update titles, descriptions, SEO fields, URL handles, tags and product categories.',
      },
      {
        q: 'How do price changes work?',
        a: 'Choose Multiply to calculate new price = current price × factor (0.7 = 30% off, 1.1 = 10% more), or Fixed to set the same price on all selected products.',
      },
      {
        q: 'Does the inventory field add to my current stock?',
        a: 'No. It sets an absolute whole-number quantity (for example 100), replacing the current quantity at your first active location.',
      },
      {
        q: 'Are all variants updated?',
        a: 'No. Price and inventory changes apply to the first variant of each product. Inventory is set at the store’s first active location. Products with several variants should be checked in Shopify.',
      },
      {
        q: 'Can I see the changes before they are applied?',
        a: 'Yes. Click Preview changes to compare current and new values for the first 50 affected products, then Confirm & apply. You can also apply directly with Apply to N products.',
      },
      {
        q: 'How many products can I load?',
        a: 'The app loads up to about 3,000 products, sorted by title, and shows them 50 per page. Use search and the status filter (All, Active, Draft, Archived) to find products quickly.',
      },
      {
        q: 'Can I export my products?',
        a: 'Yes. Export CSV downloads the selected products — or all products matching the current filter if none are selected — with title, vendor, type, category, status, tags, price and inventory.',
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI tools',
    items: [
      {
        q: 'What can the AI tools do?',
        a: 'Generate titles (up to 70 characters), descriptions (60–120 words with a bullet list), SEO meta title, meta description and URL handle, 5–8 tags, and set a product category from Shopify’s Standard Product Taxonomy. Run all with AI does everything in one run.',
      },
      {
        q: 'Is there a preview for AI changes?',
        a: 'No. AI results are saved to your products as soon as they are generated. Every AI change is recorded in History and can be reverted with Restore.',
      },
      {
        q: 'Will generating SEO change my product URLs?',
        a: 'Yes. Generate SEO & URL handle (and Run all with AI) sets a new URL handle, which changes the product’s web address. Add URL redirects in Shopify for important pages so old links keep working.',
      },
      {
        q: 'Are my existing tags replaced?',
        a: 'No. New tags are added to your existing tags and duplicates are skipped.',
      },
      {
        q: 'What information does the AI use?',
        a: 'The product title, vendor, type, category, existing description and, when available, the main product image. This data is sent to a third-party AI provider (Google Gemini) to generate content. The AI is instructed not to mention prices or invent specifications, but you should still review the output.',
      },
    ],
  },
  {
    id: 'history',
    title: 'History & restore',
    items: [
      {
        q: 'Can I undo changes?',
        a: 'Yes. Open History, find the product and click Restore. It reverts the whole product — title, description, vendor, status, type, tags, SEO, URL handle, category, price and inventory — to how it was before the app first changed it.',
      },
      {
        q: 'What does History show?',
        a: 'The most recent 100 edits made through the app, grouped by product, with what changed, when, and any errors.',
      },
      {
        q: 'Can Restore undo changes made outside the app?',
        a: 'No. Only successful edits made through OXIVOLT Bulk Editor are tracked. Changes made in the Shopify admin or by other apps are not recorded.',
      },
    ],
  },
  {
    id: 'plans',
    title: 'Plans & billing',
    items: [
      {
        q: 'How much does it cost?',
        a: 'Free is $0 and allows up to 100 products per bulk operation. Pro costs $29.99 every 30 days (Pro Monthly) or $99.99 per year (Pro Annual) and removes the limit.',
      },
      {
        q: 'What is the difference between Free and Pro?',
        a: 'The number of products you can process in a single operation: up to 100 on Free, unlimited on Pro. Bulk editing and the AI content tools are available on both plans.',
      },
      {
        q: 'How am I billed?',
        a: 'Through Shopify. You approve the charge on Shopify’s confirmation page and it appears on your regular Shopify invoice.',
      },
      {
        q: 'How do I upgrade, downgrade or cancel?',
        a: 'Open Manage Plan from the app’s menu in your Shopify admin, or click Upgrade / Manage plan in the app header. You can change or cancel at any time. Uninstalling the app also cancels its subscription.',
      },
      {
        q: 'What does “processed this month” mean?',
        a: 'A counter in the app header showing how many products the app has processed for your store in the current month.',
      },
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    items: [
      {
        q: 'I see “Select at least one product first.”',
        a: 'Tick at least one product before previewing, applying or running an AI tool.',
      },
      {
        q: 'I see “Enable at least one field to edit.”',
        a: 'Turn on the checkbox next to Vendor, Price or Inventory quantity in the Bulk edit panel.',
      },
      {
        q: 'Some products failed to update.',
        a: 'The result message shows how many products updated and how many failed; details appear in History. Click Refresh and retry the failed products.',
      },
      {
        q: 'My products or changes are not showing.',
        a: 'Click Refresh to reload from Shopify, and check that the status filter or search box is not hiding products.',
      },
      {
        q: 'The app says “Could not verify your subscription.”',
        a: 'Click Try again. If it persists, reopen the app from your Shopify admin or contact support.',
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Permissions & privacy',
    items: [
      {
        q: 'What permissions does the app need?',
        a: 'read_products and write_products (to list and edit products), read_inventory and write_inventory (to set quantities) and read_locations (to find where inventory is stored).',
      },
      {
        q: 'Does the app access customer data?',
        a: (
          <>
            No. The app works only with product data. It stores your store domain and access token, your plan, a monthly
            usage count and the edit history used by Restore. See the <Link href="/privacy" className={link}>Privacy Policy</Link>.
          </>
        ),
      },
      {
        q: 'What happens to my data when I uninstall?',
        a: 'Your access token and plan data are removed on uninstall, and the remaining shop data (including edit history) is deleted when Shopify sends its shop data-erasure request.',
      },
    ],
  },
  {
    id: 'support',
    title: 'Support',
    items: [
      {
        q: 'How do I contact support?',
        a: (
          <>
            Email <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a>. Include your store domain, what
            you were trying to do and any error message so we can help faster.
          </>
        ),
      },
      {
        q: 'Where can I see what has changed in the app?',
        a: (
          <>
            See the <Link href="/changelog" className={link}>changelog</Link>.
          </>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <ResourceShell
      current="faq"
      eyebrow="FAQ"
      title="Frequently asked questions"
      intro={
        <p>
          Quick answers about OXIVOLT Bulk Editor. Can&rsquo;t find what you need? Read the{' '}
          <Link href="/docs" className={link}>User Guide</Link> or email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>{SUPPORT_EMAIL}</a>.
        </p>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <nav aria-label="FAQ categories" className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Categories</p>
            <ul className="mt-3 flex flex-wrap gap-2 text-sm lg:block lg:space-y-1.5">
              {CATEGORIES.map((c) => (
                <li key={c.id}>
                  <a href={`#${c.id}`} className="text-muted-foreground hover:text-primary hover:underline">
                    {c.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 max-w-3xl space-y-10">
          {CATEGORIES.map((c) => (
            <section key={c.id} aria-labelledby={`${c.id}-title`} className="space-y-3">
              <h2 id={c.id} className="scroll-mt-28 font-display text-xl font-bold tracking-tight">
                <span id={`${c.id}-title`}>{c.title}</span>
              </h2>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {c.items.map((item) => (
                  <details key={item.q} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                      <span>{item.q}</span>
                      <ChevronDown
                        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-fast group-open:rotate-180"
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="px-5 pb-4 text-sm leading-relaxed text-muted-foreground">{item.a}</div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </ResourceShell>
  );
}
