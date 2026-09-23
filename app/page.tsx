import { isValidShop } from '@/lib/shopify';
import BulkEditor from '@/components/bulk-editor';
import InstallForm from '@/components/install-form';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const shopParam = typeof sp?.shop === 'string' ? sp.shop : '';
  const hostParam = typeof sp?.host === 'string' ? sp.host : '';

  // No shop context -> show the public install / landing page.
  if (!isValidShop(shopParam)) {
    return <InstallForm />;
  }

  // Shop context present -> render the embedded UI immediately.
  //
  // This app uses Shopify managed installation (token exchange), so Shopify
  // installs the app WITHOUT calling our OAuth callback, meaning no offline
  // token is written to the DB up front. We must NOT gate the UI on a stored
  // DB token: doing so left reviewers stuck on a "Connecting…" screen forever.
  //
  // Instead we always render the interactive editor. Its API calls exchange the
  // App Bridge session token for a fresh offline token on demand
  // (see lib/access-token.ts). If the merchant genuinely needs to (re)authorize
  // (e.g. new scopes), the API returns 401 reauth_required and the client
  // breaks out to /api/auth as a fallback.
  return <BulkEditor shop={shopParam} host={hostParam} />;
}
