import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';

export const dynamic = 'force-dynamic';

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          vendor
          status
          productType
          tags
          category { id name fullName }
          totalInventory
          featuredImage { url altText }
          variants(first: 1) {
            edges {
              node {
                id
                price
                inventoryQuantity
                inventoryItem { id }
              }
            }
          }
        }
      }
    }
  }
`;

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    let accessToken: string;
    try {
      accessToken = await getWorkingAccessToken(shop, token);
    } catch (e: any) {
      if (e instanceof ReauthRequiredError) {
        return NextResponse.json({ error: 'reauth_required' }, { status: 401 });
      }
      throw e;
    }

    const products: any[] = [];
    let cursor: string | null = null;
    let hasNext = true;
    let pages = 0;

    while (hasNext && pages < 30) {
      const data: any = await shopifyGraphQL(shop, accessToken, PRODUCTS_QUERY, { cursor });
      const conn = data?.products;
      const edges = conn?.edges ?? [];
      for (const edge of edges) {
        const n = edge?.node;
        if (!n) continue;
        const variant = n?.variants?.edges?.[0]?.node;
        products.push({
          id: n?.id ?? '',
          title: n?.title ?? '',
          vendor: n?.vendor ?? '',
          status: n?.status ?? '',
          productType: n?.productType ?? '',
          tags: Array.isArray(n?.tags) ? n.tags : [],
          category: n?.category?.fullName ?? n?.category?.name ?? null,
          image: n?.featuredImage?.url ?? null,
          imageAlt: n?.featuredImage?.altText ?? n?.title ?? '',
          totalInventory: n?.totalInventory ?? 0,
          variantId: variant?.id ?? null,
          price: variant?.price ?? '0.00',
          inventoryQuantity: variant?.inventoryQuantity ?? 0,
          inventoryItemId: variant?.inventoryItem?.id ?? null,
        });
      }
      hasNext = Boolean(conn?.pageInfo?.hasNextPage);
      cursor = conn?.pageInfo?.endCursor ?? null;
      pages += 1;
    }

    return NextResponse.json({ shop, products, count: products.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load products' }, { status: 500 });
  }
}
