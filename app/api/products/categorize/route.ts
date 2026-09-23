import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { getPlanInfo } from '@/lib/billing';
import { findCategoryByTerm } from '@/lib/taxonomy';
import { classifyProductCategory } from '@/lib/categorize';
import { prisma } from '@/lib/db';
import { incrementUsage } from '@/lib/usage';

export const dynamic = 'force-dynamic';

const NODES_QUERY = `
  query Nodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        productType
        descriptionHtml
        featuredImage { url }
        category { id fullName name }
      }
    }
  }
`;

const PRODUCT_SET_CATEGORY = `
  mutation SetCategory($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id category { id fullName } }
      userErrors { field message }
    }
  }
`;

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const productIds: string[] = Array.isArray(body?.productIds)
      ? body.productIds.filter((x: any) => typeof x === 'string')
      : [];
    if (productIds.length === 0) {
      return NextResponse.json({ error: 'No products provided' }, { status: 400 });
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

    // Enforce the free-plan product limit (defense in depth; the UI also gates).
    const planInfo = await getPlanInfo(shop, accessToken);
    if (planInfo.productLimit !== null && productIds.length > planInfo.productLimit) {
      return NextResponse.json(
        {
          error: 'limit_exceeded',
          message: `Your ${planInfo.planName} plan allows categorizing up to ${planInfo.productLimit} products at a time. Upgrade for unlimited.`,
          productLimit: planInfo.productLimit,
          upgradeUrl: planInfo.upgradeUrl,
        },
        { status: 402 },
      );
    }

    // Fetch the details we need to classify each product.
    const nodesData: any = await shopifyGraphQL(shop, accessToken, NODES_QUERY, { ids: productIds });
    const nodes: any[] = nodesData?.nodes ?? [];

    const results: any[] = [];

    for (const n of nodes) {
      if (!n?.id) continue;
      const oldCategory = n?.category?.fullName ?? null;
      const oldCategoryId = n?.category?.id ?? null;
      try {
        const classification = await classifyProductCategory({
          id: n.id,
          title: n.title,
          productType: n.productType,
          description: n.descriptionHtml,
          imageUrl: n?.featuredImage?.url ?? null,
        });

        if (!classification) {
          results.push({ id: n.id, title: n.title, success: false, error: 'Could not determine a category' });
          continue;
        }

        const cat = await findCategoryByTerm(shop, accessToken, classification.search);
        if (!cat) {
          results.push({
            id: n.id,
            title: n.title,
            success: false,
            error: `No matching Shopify category found for "${classification.search}"`,
          });
          continue;
        }

        const upd: any = await shopifyGraphQL(shop, accessToken, PRODUCT_SET_CATEGORY, {
          product: { id: n.id, category: cat.id },
        });
        const errs = upd?.productUpdate?.userErrors ?? [];
        if (Array.isArray(errs) && errs.length > 0) {
          const msg = errs.map((e: any) => e?.message).filter(Boolean).join('; ');
          results.push({ id: n.id, title: n.title, success: false, error: msg || 'Update rejected' });
          continue;
        }

        const newCategory = upd?.productUpdate?.product?.category?.fullName ?? cat.fullName;
        results.push({ id: n.id, title: n.title, success: true, oldCategory, newCategory });

        await prisma.editLog
          .create({
            data: {
              shop,
              productId: n.id,
              productTitle: n.title ?? null,
              changes: JSON.stringify({ category: newCategory }),
              previousValues: JSON.stringify({ category: oldCategoryId }),
              success: true,
              errorMsg: null,
            },
          })
          .catch(() => null);
      } catch (e: any) {
        results.push({ id: n.id, title: n.title, success: false, error: e?.message ?? 'Failed to categorize' });
      }
    }

    const successCount = results.filter((r) => r?.success).length;
    await incrementUsage(shop, successCount);

    return NextResponse.json({ shop, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to categorize' }, { status: 500 });
  }
}
