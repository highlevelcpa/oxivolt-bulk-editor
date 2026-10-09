import { redirect } from 'next/navigation';
import { isValidShop } from '@/lib/shopify';
import AppNav from '@/components/app-nav';
import ManagePlan from '@/components/manage-plan';

export const dynamic = 'force-dynamic';

export default async function ManagePlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const shopParam = typeof sp?.shop === 'string' ? sp.shop : '';
  const hostParam = typeof sp?.host === 'string' ? sp.host : '';

  // Outside the Shopify admin there is no shop context: send to the landing page.
  if (!isValidShop(shopParam)) redirect('/');

  return (
    <>
      <AppNav shop={shopParam} host={hostParam} />
      <ManagePlan shop={shopParam} host={hostParam} />
    </>
  );
}
