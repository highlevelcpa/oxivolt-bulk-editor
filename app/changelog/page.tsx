import Link from 'next/link';
import { ResourceShell, resourceMetadata, SUPPORT_EMAIL } from '@/components/resources/resource-shell';

export const metadata = resourceMetadata(
  'Changelog',
  'Release notes for OXIVOLT Bulk Editor: new features, improvements and bug fixes, listed by release date.',
);

/*
 * HOW TO ADD A RELEASE
 * Add a new object at the TOP of RELEASES. `date` is the deploy date (YYYY-MM-DD, also used as the
 * release identifier and anchor). Only list changes merchants can notice; omit empty groups.
 */
type Group = 'New features' | 'Improvements' | 'Bug fixes';

type Release = {
  date: string;
  title: string;
  summary?: string;
  changes: Partial<Record<Group, string[]>>;
};

const RELEASES: Release[] = [
  {
    date: '2026-10-10',
    title: 'Inventory update fix',
    changes: {
      'Bug fixes': [
        'Fixed inventory quantity updates being rejected by Shopify. Bulk inventory edits, Undo and Restore now set quantities correctly.',
        'Inventory quantities must now be whole numbers; decimal values are now rejected before anything is sent to Shopify.',
      ],
    },
  },
  {
    date: '2026-10-09',
    title: 'Plans & plan management',
    changes: {
      'New features': [
        'New plan selection screen on first use: Free ($0, up to 100 products per operation), Pro Monthly ($29.99 every 30 days) and Pro Annual ($99.99 per year), billed through Shopify.',
        'New Manage Plan page, available from the app’s menu in the Shopify admin and from the Upgrade / Manage plan button, to upgrade, switch or cancel at any time.',
      ],
      Improvements: [
        'Plan limits are now checked on the server for every bulk and AI operation.',
        'After approving or declining a charge in Shopify you are returned to the page you started from.',
        'Reinstalling the app asks you to confirm your plan again.',
        'Easier editing in the Inventory quantity field.',
      ],
    },
  },
  {
    date: '2026-09-24',
    title: 'Faster AI content generation',
    changes: {
      Improvements: [
        'Run all with AI now generates title, description, SEO and tags in a single request per product, followed by the category step — noticeably faster for large selections.',
        'More reliable AI generation with automatic failover to a backup AI provider.',
        'The app home page now lists the AI tools and one-click Restore.',
      ],
    },
  },
  {
    date: '2026-09-23',
    title: 'Initial release',
    summary: 'First public version of OXIVOLT Bulk Editor.',
    changes: {
      'New features': [
        'Product table with image, title, vendor, category, price and inventory; search, status filter (All, Active, Draft, Archived), Select all and pagination.',
        'Bulk edit vendor, price (Multiply or Fixed) and inventory quantity, with Preview changes before applying.',
        'AI Content tools: generate titles, descriptions, SEO & URL handle and tags, set product category, or Run all with AI.',
        'Edit history with one-click Restore of a product to its state before the app changed it.',
        'Export selected or filtered products to CSV.',
        'Free and Pro plans with a monthly usage counter.',
        'Privacy Policy and Shopify GDPR compliance webhooks.',
      ],
    },
  },
];

const GROUP_ORDER: Group[] = ['New features', 'Improvements', 'Bug fixes'];

const GROUP_STYLE: Record<Group, string> = {
  'New features': 'bg-primary/10 text-primary',
  Improvements: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  'Bug fixes': 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Deterministic formatting (no locale APIs) to avoid hydration mismatches.
function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export default function ChangelogPage() {
  return (
    <ResourceShell
      current="changelog"
      eyebrow="Changelog"
      title="What’s new in OXIVOLT Bulk Editor"
      intro={
        <p>
          New features, improvements and fixes, newest first. Releases are identified by their release date. Questions
          about a change? Email <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">{SUPPORT_EMAIL}</a>.
        </p>
      }
    >
      <div className="max-w-3xl">
        <ol className="relative space-y-10 border-l border-border pl-6 sm:pl-8">
          {RELEASES.map((r, i) => (
            <li key={r.date} id={r.date} className="relative scroll-mt-28">
              <span
                className={`absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-background sm:-left-[39px] ${
                  i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'
                }`}
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <time dateTime={r.date} className="font-mono text-sm text-muted-foreground">
                  {formatDate(r.date)}
                </time>
                {i === 0 ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Latest</span>
                ) : null}
              </div>
              <h2 className="mt-1 font-display text-xl font-bold tracking-tight">
                <a href={`#${r.date}`} className="hover:text-primary">{r.title}</a>
              </h2>
              {r.summary ? <p className="mt-1 text-muted-foreground">{r.summary}</p> : null}
              <div className="mt-4 space-y-4 rounded-xl border border-border bg-card p-5">
                {GROUP_ORDER.filter((g) => r.changes[g]?.length).map((g) => (
                  <div key={g}>
                    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${GROUP_STYLE[g]}`}>{g}</span>
                    <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/90">
                      {r.changes[g]!.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-12 text-sm text-muted-foreground">
          Learn how to use these features in the <Link href="/docs" className="text-primary hover:underline">User Guide</Link>{' '}
          or the <Link href="/tutorial" className="text-primary hover:underline">video tutorial</Link>.
        </p>
      </div>
    </ResourceShell>
  );
}
