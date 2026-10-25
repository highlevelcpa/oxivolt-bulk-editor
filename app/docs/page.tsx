import Link from 'next/link';
import { ResourceShell, resourceMetadata, Callout, Kbd, SUPPORT_EMAIL } from '@/components/resources/resource-shell';

export const metadata = resourceMetadata(
  'User Guide',
  'Complete user guide for OXIVOLT Bulk Editor: installation, plans, selecting products, bulk editing vendor, price and inventory, AI content tools, preview, history and restore.',
);

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'installation', label: 'Installation & first access' },
  { id: 'interface', label: 'Interface overview' },
  { id: 'bulk-editing', label: 'Product selection & bulk editing' },
  { id: 'ai-tools', label: 'AI Content tools' },
  { id: 'reviewing', label: 'Reviewing changes' },
  { id: 'best-practices', label: 'Best practices' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'permissions', label: 'Permissions & privacy' },
  { id: 'support', label: 'Support' },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 border-b border-border pb-2 font-display text-2xl font-bold tracking-tight">
      {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 font-display text-lg font-semibold">{children}</h3>;
}

export default function DocsPage() {
  return (
    <ResourceShell
      current="docs"
      eyebrow="User Guide"
      title="OXIVOLT Bulk Editor documentation"
      intro={
        <p>
          Everything you need to edit Shopify products in bulk: selecting products, changing vendor, price and inventory,
          generating content with AI, and reviewing or restoring changes. Prefer video? Watch the{' '}
          <Link href="/tutorial" className="font-medium text-primary hover:underline">
            2-minute tutorial
          </Link>
          .
        </p>
      }
    >
      <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <nav aria-label="On this page" className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
            <ol className="mt-3 space-y-1.5 text-sm">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-muted-foreground hover:text-primary hover:underline">
                    {i + 1}. {s.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="min-w-0 max-w-3xl space-y-12 leading-relaxed text-foreground/90">
          <section className="space-y-4">
            <H2 id="introduction">1. Introduction</H2>
            <p>
              <strong>OXIVOLT Bulk Editor</strong> is a Shopify app by HIGH LEVEL CPA LLC that lets you update many products
              at once instead of editing them one by one. It runs inside your Shopify admin and works directly with your
              store&rsquo;s product catalog.
            </p>
            <p>With the app you can:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Browse, search and filter all your products in one table, and select the ones to change.</li>
              <li>Bulk edit <strong>vendor</strong>, <strong>price</strong> (multiply by a factor or set a fixed price) and <strong>inventory quantity</strong>.</li>
              <li>Preview vendor, price and inventory changes before they are applied.</li>
              <li>Generate product titles, descriptions, SEO fields, tags and product categories with AI.</li>
              <li>Review the edit history and restore a product to its state before the app changed it.</li>
              <li>Export the selected (or filtered) products to CSV.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="installation">2. Installation &amp; first access</H2>
            <H3>Install the app</H3>
            <ol className="list-decimal space-y-1 pl-6">
              <li>Install OXIVOLT Bulk Editor from the Shopify App Store, or open the <Link href="/" className="text-primary hover:underline">app home page</Link>, enter your store domain (for example <Kbd>my-store.myshopify.com</Kbd>) and click <Kbd>Install</Kbd>.</li>
              <li>Review and approve the requested permissions in Shopify.</li>
              <li>Open the app from <strong>Apps</strong> in your Shopify admin.</li>
            </ol>
            <H3>Choose a plan</H3>
            <p>
              The first time you open the app you will see <strong>Choose your plan</strong>. Pick one to continue:
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/60">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Plan</th>
                    <th className="px-4 py-2 font-semibold">Price</th>
                    <th className="px-4 py-2 font-semibold">Products per bulk operation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-4 py-2 font-medium">Free</td>
                    <td className="px-4 py-2">$0</td>
                    <td className="px-4 py-2">Up to 100</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Pro Monthly</td>
                    <td className="px-4 py-2">$29.99 every 30 days</td>
                    <td className="px-4 py-2">Unlimited</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Pro Annual</td>
                    <td className="px-4 py-2">$99.99 per year</td>
                    <td className="px-4 py-2">Unlimited</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Paid plans are billed through Shopify: you approve the charge on Shopify&rsquo;s confirmation page and it
              appears on your Shopify invoice. You can change or cancel at any time from <strong>Manage Plan</strong> (in
              the app&rsquo;s menu in the Shopify admin) or with the <Kbd>Upgrade</Kbd> / <Kbd>Manage plan</Kbd> button
              in the app header. Uninstalling the app cancels its subscription.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="interface">3. Interface overview</H2>
            <H3>Header</H3>
            <ul className="list-disc space-y-1 pl-6">
              <li>Your store domain, your current plan badge (for example &ldquo;Free plan · up to 100&rdquo;) and the number of products processed this month.</li>
              <li><Kbd>Upgrade</Kbd> or <Kbd>Manage plan</Kbd> &mdash; opens plan management.</li>
              <li><Kbd>Export CSV</Kbd> &mdash; downloads the selected products, or all products matching the current filter if none are selected.</li>
              <li><Kbd>History</Kbd> &mdash; opens the edit history.</li>
              <li><Kbd>Refresh</Kbd> &mdash; reloads products from Shopify.</li>
            </ul>
            <H3>Product table (left)</H3>
            <p>
              Shows each product&rsquo;s image, title, vendor, category, price and inventory quantity. Products without a
              category are labelled <em>No category</em>. Use the status filter (All, Active, Draft, Archived), the search
              box (title, vendor, type or category), the <Kbd>Select all</Kbd> checkbox and the Previous/Next buttons
              (50 products per page).
            </p>
            <H3>Side panels (right)</H3>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>Bulk edit</strong> &mdash; vendor, price and inventory quantity, with <Kbd>Preview changes</Kbd> and <Kbd>Apply to N products</Kbd>.</li>
              <li><strong>AI Content</strong> &mdash; titles, descriptions, SEO (including URL handle), tags and category.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="bulk-editing">4. Product selection &amp; bulk editing</H2>
            <H3>Select products</H3>
            <ol className="list-decimal space-y-1 pl-6">
              <li>Narrow the list with the status filter and/or search box if needed.</li>
              <li>Tick the checkbox next to each product, or use <Kbd>Select all</Kbd> to select every product that matches the current filter (across all pages).</li>
              <li>The badge shows how many products are selected out of the filtered total.</li>
            </ol>
            <H3>Choose the fields to change</H3>
            <p>Each field has its own checkbox. Only enabled fields are changed; everything else stays as it is.</p>
            <ul className="list-disc space-y-2 pl-6">
              <li><strong>Vendor</strong> &mdash; sets the same vendor on every selected product.</li>
              <li>
                <strong>Price</strong> &mdash; two modes:
                <ul className="mt-1 list-[circle] space-y-1 pl-6">
                  <li><strong>Multiply</strong>: new price = current price × factor. For example <Kbd>0.7</Kbd> lowers prices by 30%, <Kbd>1.1</Kbd> raises them by 10%.</li>
                  <li><strong>Fixed</strong>: sets the same price on all selected products.</li>
                </ul>
              </li>
              <li><strong>Inventory quantity</strong> &mdash; sets an absolute, whole-number quantity (for example <Kbd>100</Kbd>). It does not add to or subtract from the current stock.</li>
            </ul>
            <Callout title="Variants and locations">
              <p>
                Price and inventory changes apply to each product&rsquo;s <strong>first variant</strong>. Inventory is set
                at your store&rsquo;s <strong>first active location</strong>, and the app turns on inventory tracking for
                that variant if needed. For products with several variants or locations, check the result in Shopify.
              </p>
            </Callout>
            <H3>Apply</H3>
            <p>
              Click <Kbd>Preview changes</Kbd> to review the new values first (recommended), then <Kbd>Confirm &amp; apply</Kbd>.
              You can also click <Kbd>Apply to N products</Kbd> to apply directly. A progress bar shows the update, and a
              message confirms how many products were updated and whether any failed.
            </p>
            <p>
              On the Free plan, a selection of more than 100 products is blocked with an upgrade prompt; select fewer
              products or upgrade to Pro.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="ai-tools">5. AI Content tools</H2>
            <p>
              Select products, then use the buttons in the <strong>AI Content</strong> panel. The AI uses each
              product&rsquo;s title, vendor, type, category, existing description and, when available, its main image.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/60">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Button</th>
                    <th className="px-4 py-2 font-semibold">What it does</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  <tr>
                    <td className="px-4 py-2 font-medium">Generate titles</td>
                    <td className="px-4 py-2">Writes a clear Title Case product title of up to 70 characters (no emojis or prices).</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Generate descriptions</td>
                    <td className="px-4 py-2">Writes a 60&ndash;120 word description (a short paragraph plus a bullet list) that replaces the current description.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Generate SEO &amp; URL handle</td>
                    <td className="px-4 py-2">Sets the SEO meta title (up to 60 characters), meta description (up to 155 characters) and a new lowercase, hyphenated URL handle.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Generate tags</td>
                    <td className="px-4 py-2">Adds 5&ndash;8 relevant lowercase tags. Existing tags are kept and duplicates are skipped.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Set product category</td>
                    <td className="px-4 py-2">Assigns the best matching category from Shopify&rsquo;s Standard Product Taxonomy.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-medium">Run all with AI</td>
                    <td className="px-4 py-2">Generates title, description, SEO, tags and category in one run.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Callout tone="warning" title="AI results are saved directly to Shopify">
              <p>
                There is no preview step for AI content. Results are written to your products as soon as they are
                generated. Every AI edit is recorded in <strong>History</strong> and can be reverted with <strong>Restore</strong>.
              </p>
              <p>
                <strong>Changing the URL handle changes the product&rsquo;s web address.</strong> Existing links to the old
                address may stop working unless you set up URL redirects in Shopify (Online Store &rarr; Navigation &rarr;
                URL redirects).
              </p>
            </Callout>
            <p>
              The AI is instructed not to mention prices or invent specifications, but generated text can still contain
              mistakes. Review AI content before relying on it. To generate content, product data (and images, where
              supported) is sent to a third-party AI provider (Google Gemini).
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="reviewing">6. Reviewing changes</H2>
            <H3>Preview</H3>
            <p>
              <Kbd>Preview changes</Kbd> shows a table of the first 50 affected products with the current value (struck
              through) and the new value for each enabled field. Click <Kbd>Cancel</Kbd> to go back or <Kbd>Confirm &amp; apply</Kbd> to save.
            </p>
            <H3>History</H3>
            <p>
              Click <Kbd>History</Kbd> to open <strong>Edit history</strong>. It lists the most recent 100 edits made
              through the app, grouped by product, with what changed, when, and any errors.
            </p>
            <H3>Restore</H3>
            <p>
              <Kbd>Restore</Kbd> reverts the whole product to how it was before the app first changed it &mdash; title,
              description, vendor, status, type, tags, SEO, URL handle, category, price and inventory quantity, as
              recorded in the history. Restored products are marked <em>Restored</em>.
            </p>
            <Callout title="What Restore cannot undo">
              <p>
                Restore only covers successful edits made through OXIVOLT Bulk Editor. Changes made directly in Shopify or
                by other apps are not tracked. After you uninstall the app, its edit history is deleted when Shopify sends its shop data-erasure
                request.
              </p>
            </Callout>
          </section>

          <section className="space-y-4">
            <H2 id="best-practices">7. Best practices</H2>
            <ul className="list-disc space-y-2 pl-6">
              <li><strong>Export a backup first.</strong> Use <Kbd>Export CSV</Kbd> before large changes so you have a record of the original values.</li>
              <li><strong>Test on a few products.</strong> Try new settings on two or three products before applying them to hundreds.</li>
              <li><strong>Always preview price changes.</strong> Double-check the multiplier: <Kbd>0.7</Kbd> is a 30% decrease, <Kbd>7</Kbd> would multiply prices sevenfold.</li>
              <li><strong>Be careful with URL handles.</strong> Only regenerate SEO &amp; URL handles for products where a changed web address is acceptable, and add redirects for important pages.</li>
              <li><strong>Mind variants and locations.</strong> Price and inventory edits affect the first variant and first active location only.</li>
              <li><strong>Review AI output.</strong> Spot-check generated titles and descriptions for accuracy and brand tone.</li>
              <li><strong>Refresh after outside edits.</strong> If products were changed elsewhere while the app was open, click <Kbd>Refresh</Kbd> before editing.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="troubleshooting">8. Troubleshooting</H2>
            <dl className="space-y-4">
              {[
                ['“Select at least one product first.”', 'Tick at least one product checkbox before previewing, applying or running an AI tool.'],
                ['“Enable at least one field to edit.”', 'Turn on the checkbox next to Vendor, Price or Inventory quantity.'],
                ['“Your Free plan is limited to 100 products…”', 'Select 100 products or fewer per operation, or upgrade to Pro for unlimited products.'],
                ['Some products failed to update', 'The result message shows how many updated and how many failed; failure details are listed in History. Click Refresh and try the failed products again.'],
                ['Products or changes are not showing', 'Click Refresh to reload products from Shopify. Check that the status filter and search box are not hiding them.'],
                ['“No matching Shopify category found”', 'The AI suggestion could not be matched to Shopify’s taxonomy. Try again, or set the category manually in Shopify.'],
                ['“Could not verify your subscription.”', 'Click Try again. If it persists, reopen the app from your Shopify admin.'],
                ['“Updating app permissions… redirecting to Shopify.”', 'The app needs you to approve updated permissions. Follow the Shopify prompt, then the app reloads.'],
              ].map(([q, a]) => (
                <div key={q} className="rounded-lg border border-border p-4">
                  <dt className="font-semibold">{q}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-4">
            <H2 id="permissions">9. Permissions &amp; privacy</H2>
            <p>The app requests these Shopify permissions:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><code className="rounded bg-secondary px-1 font-mono text-sm">read_products</code> / <code className="rounded bg-secondary px-1 font-mono text-sm">write_products</code> &mdash; list and edit your products.</li>
              <li><code className="rounded bg-secondary px-1 font-mono text-sm">read_inventory</code> / <code className="rounded bg-secondary px-1 font-mono text-sm">write_inventory</code> &mdash; set inventory quantities.</li>
              <li><code className="rounded bg-secondary px-1 font-mono text-sm">read_locations</code> &mdash; find the location where inventory is set.</li>
            </ul>
            <p>
              The app does not access customer data. It stores your store domain and access token, your plan, a monthly
              count of processed products and the edit history needed for Restore. Shop data is removed after you
              uninstall, in line with Shopify&rsquo;s data-erasure requests. Read the full{' '}
              <Link href="/privacy" className="font-medium text-primary hover:underline">Privacy Policy</Link>.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="support">10. Support</H2>
            <p>
              Email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">{SUPPORT_EMAIL}</a>{' '}
              and include your store domain, what you were trying to do and any error message shown. You can also check
              the <Link href="/faq" className="text-primary hover:underline">FAQ</Link>, the{' '}
              <Link href="/tutorial" className="text-primary hover:underline">video tutorial</Link> and the{' '}
              <Link href="/changelog" className="text-primary hover:underline">changelog</Link>.
            </p>
          </section>
        </article>
      </div>
    </ResourceShell>
  );
}
