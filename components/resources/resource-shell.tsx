import Link from 'next/link';
import type { Metadata } from 'next';
import { Mail } from 'lucide-react';
import { ResourceHeader } from './resource-header';
import { NAV, type ResourceKey } from './resource-nav';

// Shared chrome for the public Help Center pages (/docs, /tutorial, /faq, /changelog, /privacy).
// Server component; only the header (mobile menu toggle) ships client JS.

export const SUPPORT_EMAIL = 'support@highlevelcpa.shop';
export const YOUTUBE_ID = '8d0bBvcYTcs';

export type { ResourceKey };
export { NAV };

export function resourceMetadata(title: string, description: string): Metadata {
  const fullTitle = `${title} — OXIVOLT Bulk Editor`;
  return {
    title: fullTitle,
    description,
    openGraph: { title: fullTitle, description, images: ['/og-image.png'] },
  };
}

export function ResourceShell({
  current,
  eyebrow,
  title,
  intro,
  children,
}: {
  current: ResourceKey;
  eyebrow: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <ResourceHeader current={current} />

      <main id="content" className="flex-1">
        <section className="hero-gradient border-b border-border">
          <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
            <h1 className="mt-2 max-w-3xl font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <div className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{intro}</div>
          </div>
        </section>
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12">{children}</div>
      </main>

      <footer className="border-t border-border bg-secondary/40">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
          <div>
            <p className="font-display text-base font-semibold">OXIVOLT Bulk Editor</p>
            <p className="mt-2 text-sm text-muted-foreground">
              A Shopify app by HIGH LEVEL CPA LLC for editing products in bulk.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold">Resources</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {NAV.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="text-muted-foreground hover:text-primary hover:underline">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/" className="text-muted-foreground hover:text-primary hover:underline">
                  App home
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Support</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-2 inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> {SUPPORT_EMAIL}
            </a>
            <p className="mt-2 text-sm text-muted-foreground">
              Include your store domain (your-store.myshopify.com) so we can help faster.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Small shared building blocks for consistent typography across resource pages.
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning';
  title: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === 'warning'
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'
      : 'border-primary/30 bg-primary/5 text-foreground';
  return (
    <div className={`my-5 rounded-lg border p-4 text-sm leading-relaxed ${styles}`} role="note">
      <p className="font-semibold">{title}</p>
      <div className="mt-1 space-y-2">{children}</div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded border border-border bg-secondary px-1.5 py-0.5 text-[0.85em] font-medium text-foreground">
      {children}
    </span>
  );
}
