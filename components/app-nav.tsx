// Shopify admin sidebar navigation (App Bridge <ui-nav-menu>). Items appear
// under the app name in the Shopify admin left nav; the rel="home" link is the
// app name itself and is not rendered as a separate item.
//
// shop/host are carried on every link so each page keeps its embedded context.
export function appHref(path: string, shop: string, host: string): string {
  const qs = new URLSearchParams({ shop });
  if (host) qs.set('host', host);
  return `${path}?${qs.toString()}`;
}

export default function AppNav({ shop, host }: { shop: string; host: string }) {
  return (
    <ui-nav-menu>
      <a href={appHref('/', shop, host)} rel="home">
        OXIVOLT Bulk Editor
      </a>
      <a href={appHref('/manage-plan', shop, host)}>Manage Plan</a>
    </ui-nav-menu>
  );
}
