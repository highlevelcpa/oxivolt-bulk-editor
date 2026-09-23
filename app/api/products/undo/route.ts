import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const LOCATION_QUERY = `
  query { locations(first: 1, includeInactive: false) { edges { node { id } } } }
`;

const PRODUCT_UPDATE = `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }
`;

const VARIANT_PRICE_UPDATE = `
  mutation VariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

const INV_SET = `
  mutation InvSet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { field message }
    }
  }
`;

function firstError(errs: any[]): string | null {
  if (Array.isArray(errs) && errs.length > 0) {
    return errs.map((e: any) => e?.message ?? '').filter(Boolean).join('; ') || null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const editLogId: string = typeof body?.editLogId === 'string' ? body.editLogId : '';
    if (!editLogId) {
      return NextResponse.json({ error: 'Missing editLogId' }, { status: 400 });
    }

    const entry = await prisma.editLog.findFirst({ where: { id: editLogId, shop } });
    if (!entry) {
      return NextResponse.json({ error: 'Edit not found' }, { status: 404 });
    }
    if (entry.undone) {
      return NextResponse.json({ error: 'This edit was already undone' }, { status: 400 });
    }
    if (!entry.success) {
      return NextResponse.json({ error: 'Cannot undo a failed edit' }, { status: 400 });
    }
    if (!entry.previousValues || entry.previousValues === '{}' || entry.previousValues === 'null') {
      return NextResponse.json({ error: 'No previous values stored for this edit' }, { status: 400 });
    }

    let previous: any;
    try {
      previous = JSON.parse(entry.previousValues);
    } catch {
      return NextResponse.json({ error: 'Could not read previous values' }, { status: 400 });
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

    const productId = entry.productId;
    const errorParts: string[] = [];

    // 1) Product-level fields.
    const productInput: Record<string, any> = { id: productId };
    if ('title' in previous) productInput.title = previous.title;
    if ('descriptionHtml' in previous) productInput.descriptionHtml = previous.descriptionHtml ?? '';
    if ('vendor' in previous) productInput.vendor = previous.vendor ?? '';
    if ('status' in previous && previous.status) productInput.status = String(previous.status).toUpperCase();
    if ('productType' in previous) productInput.productType = previous.productType ?? '';
    if ('tags' in previous) productInput.tags = Array.isArray(previous.tags) ? previous.tags : [];
    if ('seo' in previous && previous.seo) {
      productInput.seo = {
        title: previous.seo.title ?? '',
        description: previous.seo.description ?? '',
      };
    }
    if ('handle' in previous && previous.handle) productInput.handle = previous.handle;
    if ('category' in previous) productInput.category = previous.category ?? null;

    if (Object.keys(productInput).length > 1) {
      try {
        const d: any = await shopifyGraphQL(shop, accessToken, PRODUCT_UPDATE, { product: productInput });
        const err = firstError(d?.productUpdate?.userErrors);
        if (err) errorParts.push(`fields: ${err}`);
      } catch (e: any) {
        errorParts.push(`fields: ${e?.message ?? 'error'}`);
      }
    }

    // 2) Price.
    if (previous?.price !== null && previous?.price !== undefined && previous?.variantId) {
      try {
        const d: any = await shopifyGraphQL(shop, accessToken, VARIANT_PRICE_UPDATE, {
          productId,
          variants: [{ id: previous.variantId, price: String(previous.price) }],
        });
        const err = firstError(d?.productVariantsBulkUpdate?.userErrors);
        if (err) errorParts.push(`price: ${err}`);
      } catch (e: any) {
        errorParts.push(`price: ${e?.message ?? 'error'}`);
      }
    }

    // 3) Quantity / inventory.
    if (previous?.quantity !== null && previous?.quantity !== undefined && previous?.inventoryItemId) {
      let locationId: string | null = previous?.locationId ?? null;
      if (!locationId) {
        try {
          const locData: any = await shopifyGraphQL(shop, accessToken, LOCATION_QUERY);
          locationId = locData?.locations?.edges?.[0]?.node?.id ?? null;
        } catch {
          locationId = null;
        }
      }
      if (!locationId) {
        errorParts.push('quantity: no active store location found');
      } else {
        try {
          const d: any = await shopifyGraphQL(shop, accessToken, INV_SET, {
            input: {
              name: 'available',
              reason: 'correction',
              ignoreCompareQuantity: true,
              quantities: [
                {
                  inventoryItemId: previous.inventoryItemId,
                  locationId,
                  quantity: Number(previous.quantity),
                },
              ],
            },
          });
          const err = firstError(d?.inventorySetQuantities?.userErrors);
          if (err) errorParts.push(`quantity: ${err}`);
        } catch (e: any) {
          errorParts.push(`quantity: ${e?.message ?? 'error'}`);
        }
      }
    }

    if (errorParts.length > 0) {
      return NextResponse.json({ success: false, error: errorParts.join(' | ') }, { status: 200 });
    }

    await prisma.editLog
      .update({ where: { id: entry.id }, data: { undone: true, undoneAt: new Date() } })
      .catch(() => null);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Undo failed' }, { status: 500 });
  }
}
