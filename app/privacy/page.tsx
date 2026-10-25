import Link from 'next/link';
import { ResourceShell, resourceMetadata, Callout, SUPPORT_EMAIL } from '@/components/resources/resource-shell';

export const metadata = resourceMetadata(
  'Privacy Policy',
  'Privacy Policy for the OXIVOLT Bulk Editor Shopify app: what data the app accesses and stores, how AI features process product data, billing, retention, deletion and GDPR compliance.',
);

const LAST_UPDATED = 'October 25, 2026';

const SECTIONS = [
  { id: 'introduction', label: 'Introduction' },
  { id: 'information-we-access', label: 'Information we access' },
  { id: 'how-we-use', label: 'How we use your information' },
  { id: 'ai-features', label: 'AI-assisted features' },
  { id: 'service-providers', label: 'External service providers' },
  { id: 'data-we-store', label: 'Data we store' },
  { id: 'billing', label: 'Billing and payments' },
  { id: 'retention', label: 'Data retention and deletion' },
  { id: 'gdpr', label: 'GDPR and compliance webhooks' },
  { id: 'security', label: 'Data security' },
  { id: 'merchant-responsibilities', label: 'Merchant responsibilities' },
  { id: 'changes', label: 'Changes to this policy' },
  { id: 'contact', label: 'Contact us' },
];

const a = 'font-medium text-primary hover:underline';
const code = 'rounded bg-secondary px-1 font-mono text-[0.85em]';
const th = 'px-4 py-2 font-semibold';
const td = 'px-4 py-2 align-top';

function H2({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 border-b border-border pb-2 font-display text-2xl font-bold tracking-tight">
      {n}. {children}
    </h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 font-display text-lg font-semibold">{children}</h3>;
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={a}>
      {children}
    </a>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary/60">
          <tr>
            {head.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`${td} ${j === 0 ? 'font-medium' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <ResourceShell
      current="privacy"
      eyebrow="Legal"
      title="Privacy Policy"
      intro={
        <p>
          How OXIVOLT Bulk Editor accesses, uses, stores and deletes information when you use the app on your Shopify
          store. <span className="block pt-2 text-sm">Last updated: {LAST_UPDATED}</span>
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
            <H2 id="introduction" n={1}>Introduction</H2>
            <p>
              This Privacy Policy describes how <strong>OXIVOLT Bulk Editor</strong> (the &ldquo;App&rdquo;), operated by{' '}
              <strong>HIGH LEVEL CPA LLC</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;), collects,
              uses, shares, stores and deletes information when a Shopify merchant (&ldquo;you&rdquo;) installs and uses
              the App.
            </p>
            <p>
              The App is a product-management tool. It works with your store&rsquo;s <strong>product data</strong> only.{' '}
              <strong>It does not request access to, collect, store or process your customers&rsquo; personal data</strong>{' '}
              (such as names, addresses, emails or orders).
            </p>
            <p>
              Questions about this policy can be sent to{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={a}>{SUPPORT_EMAIL}</a>.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="information-we-access" n={2}>Information we access</H2>
            <p>
              When you install the App you grant it the following Shopify Admin API permissions (&ldquo;scopes&rdquo;). The
              App uses them only to perform actions you start.
            </p>
            <Table
              head={['Scope', 'What it allows', 'Why the App needs it']}
              rows={[
                [<code key="1" className={code}>read_products</code>, 'Read your products.', 'To list products and read the fields you edit (see below).'],
                [<code key="2" className={code}>write_products</code>, 'Update your products.', 'To save bulk edits, AI-generated content, categories and restores.'],
                [<code key="3" className={code}>read_inventory</code>, 'Read inventory levels.', 'To show and record current stock quantities.'],
                [<code key="4" className={code}>write_inventory</code>, 'Update inventory levels.', 'To set the inventory quantity you choose.'],
                [<code key="5" className={code}>read_locations</code>, 'Read your store locations.', 'To find the location where inventory quantities are set.'],
              ]}
            />
            <p>Through these scopes the App may read the following product information:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Product ID, title, vendor, product type, status, tags, description, URL handle, SEO title and description, and product category.</li>
              <li>The product&rsquo;s featured image URL.</li>
              <li>The first variant&rsquo;s price, inventory quantity and inventory item ID.</li>
              <li>Your store&rsquo;s locations (to identify the first active location for inventory updates).</li>
            </ul>
            <p>
              The App also receives your store domain (for example <code className={code}>your-store.myshopify.com</code>)
              and a Shopify access token when you install it, and short-lived Shopify session tokens each time you open it.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="how-we-use" n={3}>How we use your information</H2>
            <p>We use the information described above only to provide the App&rsquo;s features to you:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>Displaying products</strong> in the App so you can search, filter, select and export them (CSV export is generated in your browser).</li>
              <li><strong>Bulk editing</strong> the vendor, price and inventory quantity of the products you select.</li>
              <li><strong>AI-assisted content</strong>: generating titles, descriptions, SEO fields, URL handles, tags and product categories when you click an AI button (see section 4).</li>
              <li><strong>Edit history, undo and restore</strong>: recording what changed and the previous values so you can review and revert edits.</li>
              <li><strong>Plans and limits</strong>: checking your plan, enforcing the per-operation product limit and counting products processed each month.</li>
              <li><strong>Security and troubleshooting</strong>: verifying requests and keeping technical error logs.</li>
            </ul>
            <p>
              We do not sell or rent your information, do not use it for advertising, and share it only with the service
              providers listed in section 5 as needed to run the App.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="ai-features" n={4}>AI-assisted features</H2>
            <p>
              AI processing happens <strong>only when you click an AI button</strong> in the App (Generate titles, Generate
              descriptions, Generate SEO &amp; URL handle, Generate tags, Set product category, or Run all with AI) and
              only for the products you selected. For each product, the App sends the following to an AI provider:
            </p>
            <Table
              head={['Operation', 'Text sent', 'Product image sent?']}
              rows={[
                ['Generate titles', 'Title, vendor, product type, category, first 500 characters of the description', 'Yes, if available'],
                ['Generate descriptions', 'Title, vendor, product type, category, first 800 characters of the description', 'Yes, if available'],
                ['Generate tags', 'Title, vendor, product type, category, first 500 characters of the description', 'Yes, if available'],
                ['Generate SEO & URL handle', 'Title, vendor, product type, category, first 600 characters of the description', 'No (text only)'],
                ['Run all with AI (title, description, SEO, tags)', 'Title, vendor, product type, category, first 700 characters of the description', 'Yes, if available'],
                ['Set product category', 'Title, product type, first 600 characters of the description', 'Yes, if available'],
              ]}
            />
            <H3>Product images</H3>
            <p>
              When an operation uses an image, our server downloads the product&rsquo;s featured image from its Shopify
              URL and sends it to Google Gemini. Images are only sent if the product has a featured image and the file is
              4&nbsp;MB or smaller. Images are never sent to the backup provider (Abacus.AI).
            </p>
            <H3>What is never sent to AI providers</H3>
            <ul className="list-disc space-y-1 pl-6">
              <li>Prices or any other monetary amounts.</li>
              <li>Inventory quantities or location data.</li>
              <li>Your Shopify access token or session tokens.</li>
              <li>Customer personal data (the App does not access it).</li>
            </ul>
            <H3>Which AI providers are used</H3>
            <ul className="list-disc space-y-1 pl-6">
              <li><strong>Google Gemini</strong> (Gemini API by Google) is the primary provider and processes text and images.</li>
              <li>
                <strong>Abacus.AI RouteLLM</strong> is a backup used <strong>only if all Gemini requests fail</strong>. It
                receives the text listed above only, never images.
              </li>
            </ul>
            <p>
              AI-generated results are written directly to your Shopify products and recorded in the App&rsquo;s edit
              history, so you can review and restore them.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="service-providers" n={5}>External service providers</H2>
            <p>We rely on the following third parties to operate the App:</p>
            <Table
              head={['Provider', 'Purpose', 'Data involved', 'Privacy information']}
              rows={[
                ['Shopify', 'E-commerce platform, App authentication and billing', 'All App interactions with your store', <Ext key="s" href="https://www.shopify.com/legal/privacy">Shopify Privacy Policy</Ext>],
                ['Google (Gemini API)', 'Primary AI provider', 'Product text and images listed in section 4', <span key="g" className="space-y-1"><Ext href="https://policies.google.com/privacy">Google Privacy Policy</Ext><br /><Ext href="https://ai.google.dev/gemini-api/terms">Gemini API Terms</Ext></span>],
                ['Abacus.AI (RouteLLM)', 'Backup AI provider, used only if Gemini fails', 'Product text listed in section 4 (no images)', <Ext key="a" href="https://abacus.ai/privacy">Abacus.AI Privacy Policy</Ext>],
                ['Railway', 'Application hosting', 'The App and the data it stores (section 6)', <Ext key="r" href="https://railway.com/legal/privacy">Railway Privacy Policy</Ext>],
              ]}
            />
            <p>
              Each provider processes data under its own terms and privacy policy, which may apply different rules
              depending on the service tier used. These providers may process data in the United States and other
              countries.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="data-we-store" n={6}>Data we store</H2>
            <p>The App stores the following records in its database, keyed by your store domain:</p>
            <Table
              head={['Record', 'Contents', 'Purpose']}
              rows={[
                ['Shop session', 'Store domain, Shopify offline access token, granted scopes, token expiry time, install and update timestamps', 'Lets the App call the Shopify API on your behalf'],
                ['Billing record', 'Store domain, Shopify installation ID, date you selected the Free plan, Shopify subscription ID and status, pending subscription ID and plan, result and date of the last charge approval', 'Remembers your plan choice and tracks plan approvals'],
                ['Edit log', 'Product ID and title, a description of each change, a snapshot of the previous values (for example title, description, vendor, status, type, tags, SEO fields, URL handle, category, price and inventory quantity), success or error message, undo status and timestamps', 'Powers Edit history, undo and restore'],
                ['Usage counter', 'Store domain, calendar month (UTC) and number of products processed', 'Shows monthly usage in the App'],
              ]}
            />
            <p>
              The App does not store copies of product images, AI prompts or customer information. It also keeps a
              short-lived in-memory cache of your plan status to reduce calls to Shopify. Technical error logs kept by our
              hosting provider may occasionally include product identifiers or short excerpts of AI responses.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="billing" n={7}>Billing and payments</H2>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Paid plans (Pro Monthly and Pro Annual) are charged through <strong>Shopify&rsquo;s Billing API</strong>. You
                approve each subscription on Shopify&rsquo;s confirmation page, and charges appear on your Shopify invoice.
              </li>
              <li>
                <strong>The App never receives, processes or stores payment card or bank details.</strong> All payment
                processing is handled by Shopify.
              </li>
              <li>
                Your active subscription is always checked live with Shopify. The App only stores the billing identifiers and
                statuses listed in section 6.
              </li>
              <li>Development stores may receive test charges, which are not billed.</li>
              <li>
                You can change or cancel your plan at any time from the App. Shopify cancels the App&rsquo;s subscription
                when you uninstall the App.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <H2 id="retention" n={8}>Data retention and deletion</H2>
            <p>
              <strong>While the App is installed</strong>, we keep the records described in section 6 so the App can work
              and so that Edit history and Restore are available.
            </p>
            <Table
              head={['Event', 'What is deleted', 'What is kept']}
              rows={[
                ['You uninstall the App', 'Shop session (including the access token) and billing record; the cached plan status is cleared', 'Edit logs and usage counters, until Shopify sends the shop data-erasure request'],
                ['Shopify shop data-erasure request (shop/redact), sent by Shopify 48 hours after uninstall', 'All remaining data for your store: edit logs, shop session, usage counters and billing record', 'Nothing'],
              ]}
            />
            <p>
              To request access to or deletion of your store&rsquo;s data at any other time, contact us at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={a}>{SUPPORT_EMAIL}</a>. Data already sent to AI providers is
              retained according to those providers&rsquo; policies (see section 5).
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="gdpr" n={9}>GDPR and compliance webhooks</H2>
            <p>
              The App implements Shopify&rsquo;s mandatory privacy compliance webhooks. Each request&rsquo;s HMAC signature is
              verified, and invalid requests are rejected.
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <code className={code}>customers/data_request</code> &mdash; acknowledged. The App holds no customer personal
                data, so there is nothing to return.
              </li>
              <li>
                <code className={code}>customers/redact</code> &mdash; acknowledged. The App holds no customer personal data, so
                there is nothing to erase.
              </li>
              <li>
                <code className={code}>shop/redact</code> &mdash; deletes all data stored for the store, as described in section 8.
              </li>
            </ul>
            <p>
              Depending on where you are located, you may have rights to access, correct or delete personal data. Contact us
              to exercise them.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="security" n={10}>Data security</H2>
            <ul className="list-disc space-y-1 pl-6">
              <li>All communication with Shopify, AI providers and your browser uses encrypted HTTPS connections.</li>
              <li>Requests from inside the Shopify admin are authenticated with Shopify session tokens, whose signatures are verified by the App&rsquo;s server.</li>
              <li>OAuth installation callbacks and webhooks are verified with Shopify HMAC signatures.</li>
              <li>Access tokens are kept server-side in the App&rsquo;s database, never in your browser, and access to the database is restricted.</li>
            </ul>
            <p>No method of transmission or storage is completely secure, but we work to protect your information.</p>
          </section>

          <section className="space-y-4">
            <H2 id="merchant-responsibilities" n={11}>Merchant responsibilities</H2>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>Review AI-generated content.</strong> AI output can be inaccurate or incomplete. You are responsible for
                the product titles, descriptions, SEO fields, tags and categories published on your store.
              </li>
              <li>
                <strong>Avoid confidential information in product data</strong> you process with AI tools, because it is sent
                to the AI providers listed above.
              </li>
              <li>
                <strong>Check URL handle changes.</strong> Generating SEO &amp; URL handles changes product web addresses;
                set up redirects in Shopify where needed.
              </li>
              <li>Keep your own backups (for example with Export CSV) before large changes.</li>
            </ul>
            <Callout title="Learn more">
              <p>
                See the <Link href="/docs#ai-tools" className={a}>User Guide</Link> for how each AI tool works and the{' '}
                <Link href="/faq#privacy" className={a}>FAQ</Link> for common privacy questions.
              </p>
            </Callout>
          </section>

          <section className="space-y-4">
            <H2 id="changes" n={12}>Changes to this policy</H2>
            <p>
              We may update this Privacy Policy when the App or our providers change. Updates are posted on this page with a
              new &ldquo;Last updated&rdquo; date.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="contact" n={13}>Contact us</H2>
            <p>
              HIGH LEVEL CPA LLC
              <br />
              Email: <a href={`mailto:${SUPPORT_EMAIL}`} className={a}>{SUPPORT_EMAIL}</a>
            </p>
            <p>Please include your store domain so we can locate your data.</p>
          </section>
        </article>
      </div>
    </ResourceShell>
  );
}
