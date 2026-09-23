import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { getPlanInfo } from '@/lib/billing';
import { generateDescription, generateSeo, generateTags, generateTitle } from '@/lib/enhance';
import { prisma } from '@/lib/db';
import { incrementUsage } from '@/lib/usage';

export const dynamic = 'force-dynamic';

const NODES_QUERY = `
  query Nodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        vendor
        productType
        descriptionHtml
        tags
        seo { title description }
        featuredImage { url }
        category { id fullName name }
      }
    }
  }
`;

const PRODUCT_UPDATE = `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
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
    const mode: 'description' | 'seo' | 'tags' | 'title' =
      body?.mode === 'seo'
        ? 'seo'
        : body?.mode === 'tags'
          ? 'tags'
          : body?.mode === 'title'
            ? 'title'
            : 'description';
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
          message: `Your ${planInfo.planName} plan allows processing up to ${planInfo.productLimit} products at a time. Upgrade for unlimited.`,
          productLimit: planInfo.productLimit,
          upgradeUrl: planInfo.upgradeUrl,
        },
        { status: 402 },
      );
    }

    const nodesData: any = await shopifyGraphQL(shop, accessToken, NODES_QUERY, { ids: productIds });
    const nodes: any[] = nodesData?.nodes ?? [];
    const results: any[] = [];

    for (const n of nodes) {
      if (!n?.id) continue;
      try {
        const p = {
          id: n.id,
          title: n.title,
          vendor: n.vendor,
          productType: n.productType,
          description: n.descriptionHtml,
          category: n?.category?.fullName ?? n?.category?.name ?? null,
          imageUrl: n?.featuredImage?.url ?? null,
        };

        const productInput: any = { id: n.id };
        let changes: any = {};
        let previous: any = {};

        if (mode === 'title') {
          const newTitle = await generateTitle(p);
          if (!newTitle) {
            results.push({ id: n.id, title: n.title, success: false, error: 'Could not generate title' });
            continue;
          }
          productInput.title = newTitle;
          changes = { title: newTitle };
          previous = { title: n.title ?? null };
        } else if (mode === 'seo') {
          const seo = await generateSeo(p);
          if (!seo) {
            results.push({ id: n.id, title: n.title, success: false, error: 'Could not generate SEO' });
            continue;
          }
          productInput.seo = { title: seo.title, description: seo.description };
          if (seo.handle) productInput.handle = seo.handle;
          changes = { seoTitle: seo.title, seoDescription: seo.description, urlHandle: seo.handle || '(unchanged)' };
          previous = {
            seo: { title: n?.seo?.title ?? null, description: n?.seo?.description ?? null },
            handle: n?.handle ?? null,
          };
        } else if (mode === 'tags') {
          const aiTags = await generateTags(p);
          if (!aiTags || aiTags.length === 0) {
            results.push({ id: n.id, title: n.title, success: false, error: 'Could not generate tags' });
            continue;
          }
          const existing: string[] = Array.isArray(n?.tags) ? n.tags : [];
          const seen = new Set(existing.map((t: string) => String(t).toLowerCase()));
          const added: string[] = [];
          for (const t of aiTags) {
            const k = t.toLowerCase();
            if (!seen.has(k)) {
              seen.add(k);
              added.push(t);
            }
          }
          if (added.length === 0) {
            results.push({ id: n.id, title: n.title, success: true, note: 'No new tags' });
            continue;
          }
          productInput.tags = [...existing, ...added];
          changes = { tagsAdded: added.join(', ') };
          previous = { tags: existing };
        } else {
          const html = await generateDescription(p);
          if (!html) {
            results.push({ id: n.id, title: n.title, success: false, error: 'Could not generate description' });
            continue;
          }
          productInput.descriptionHtml = html;
          changes = { description: 'AI generated' };
          previous = { descriptionHtml: n?.descriptionHtml ?? '' };
        }

        const upd: any = await shopifyGraphQL(shop, accessToken, PRODUCT_UPDATE, { product: productInput });
        const errs = upd?.productUpdate?.userErrors ?? [];
        if (Array.isArray(errs) && errs.length > 0) {
          const msg = errs.map((e: any) => e?.message).filter(Boolean).join('; ');
          results.push({ id: n.id, title: n.title, success: false, error: msg || 'Update rejected' });
          continue;
        }

        results.push({ id: n.id, title: n.title, success: true });
        await prisma.editLog
          .create({
            data: {
              shop,
              productId: n.id,
              productTitle: n.title ?? null,
              changes: JSON.stringify(changes),
              previousValues: JSON.stringify(previous),
              success: true,
              errorMsg: null,
            },
          })
          .catch(() => null);
      } catch (e: any) {
        results.push({ id: n.id, title: n.title, success: false, error: e?.message ?? 'Failed to enhance' });
      }
    }

    const successCount = results.filter((r) => r?.success).length;
    await incrementUsage(shop, successCount);

    return NextResponse.json({ shop, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to enhance' }, { status: 500 });
  }
}
