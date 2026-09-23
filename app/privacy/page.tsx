import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — OXIVOLT Bulk Editor',
  description: 'Privacy Policy for the OXIVOLT Bulk Editor Shopify app.',
};

export default function PrivacyPolicyPage() {
  const updated = 'September 22, 2026';
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800">
      <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>

      <section className="mt-8 space-y-4 leading-relaxed">
        <p>
          This Privacy Policy describes how <strong>OXIVOLT Bulk Editor</strong> (the
          &ldquo;App&rdquo;), operated by HIGH LEVEL CPA LLC (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;, or &ldquo;our&rdquo;), collects, uses, and protects information
          when you install and use the App on your Shopify store.
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">1. Information We Access</h2>
        <p>
          The App is a product management tool. To provide its functionality it accesses,
          through the Shopify Admin API and only with your permission (scopes
          <code className="mx-1 rounded bg-slate-100 px-1">read_products</code> and
          <code className="mx-1 rounded bg-slate-100 px-1">write_products</code>):
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Product information (title, vendor, price, and inventory quantity).</li>
          <li>
            Your store domain and an offline access token, which are stored securely so the
            App can perform the edits you request.
          </li>
        </ul>
        <p>
          <strong>
            The App does not access, collect, store, or process any customer personal data.
          </strong>{' '}
          It only reads and edits product data that you explicitly choose to modify.
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">2. How We Use Information</h2>
        <p>
          We use the product data solely to display your products inside the App and to apply
          the bulk changes (vendor, price, inventory) that you initiate. We keep a short audit
          log of the edits performed so you can review what was changed. We never sell or share
          your data with third parties.
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">3. Data Retention</h2>
        <p>
          Your store session and edit logs are retained while the App is installed. When you
          uninstall the App, the stored access token is removed. In accordance with GDPR
          compliance requirements, any remaining shop data is deleted upon receiving Shopify&rsquo;s
          shop data erasure request (sent 48 hours after uninstall).
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">4. Data Security</h2>
        <p>
          All communication with Shopify occurs over encrypted HTTPS connections. Access tokens
          are stored securely and all requests are verified using Shopify HMAC signatures and
          session tokens.
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">5. GDPR Compliance</h2>
        <p>
          Because the App does not process customer personal data, we have no customer data to
          return or erase. We nonetheless implement all of Shopify&rsquo;s mandatory compliance
          webhooks (<code className="mx-1 rounded bg-slate-100 px-1">customers/data_request</code>,
          <code className="mx-1 rounded bg-slate-100 px-1">customers/redact</code>, and
          <code className="mx-1 rounded bg-slate-100 px-1">shop/redact</code>) and delete shop-level
          data on request.
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">6. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Changes will be posted on this page
          with an updated revision date.
        </p>

        <h2 className="pt-4 text-xl font-semibold text-slate-900">7. Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy or how your data is handled, please
          contact us at{' '}
          <a className="text-blue-600 underline" href="mailto:support@highlevelcpa.shop">
            support@highlevelcpa.shop
          </a>
          .
        </p>
      </section>
    </main>
  );
}
