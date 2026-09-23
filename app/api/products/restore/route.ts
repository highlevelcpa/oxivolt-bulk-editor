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

/**
 * Restore an ENTIRE product to the state it had before ANY tracked edit.
 *
 * Each EditLog row stores `previousValues` = the value of the affected field(s)
 * BEFORE that specific edit. To rebuild the true original state we walk the
 * product's non-undone edits from OLDEST to NEWEST and, for every field, keep the
 * value from the earliest edit that touched it (that is the pristine original).
 * Then we apply all of them at once and mark every reverted row as undone.
 */
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const productId: string = typeof body?.productId === 'string' ? body.productId : '';
    if (!productId) {
      return NextResponse.json({ error: 'Missing productId' }, { status: 400 });
    }

    // All revertible edits for this product, oldest first.
    const entries = await prisma.editLog.findMany({
      where: { shop, productId, success: true, undone: false },
      orderBy: { createdAt: 'asc' },
    });

    const revertible = entries.filter(
      (e) => !!e.previousValues && e.previousValues !== '{}' && e.previousValues !== 'null',
    );

    if (revertible.length === 0) {
      return NextResponse.json(
        { error: 'Nothing to restore for this product (no saved original values).' },
        { status: 400 },
      );
    }

    // Merge: keep the EARLIEST value for each field = the pristine original.
    const merged: Record<string, any> = {};
    const has = (k: string) => Object.prototype.hasOwnProperty.call(merged, k);
    for (const e of revertible) {
      let prev: any;
      try {
        prev = JSON.parse(e.previousValues as string);
      } catch {
        continue;
      }
      if (!prev || typeof prev !== 'object') continue;
      for (const key of [
        'title',
        'descriptionHtml',
        'vendor',
        'status',
        'productType',
        'tags',
        'seo',
        'handle',
        'category',
      ]) {
        if (key in prev && !has(key)) merged[key] = prev[key];
      }
      if ('price' in prev && !has('price')) {
        merged.price = prev.price;
        merged.variantId = prev.variantId;
      }
      if ('quantity' in prev && !has('quantity')) {
        merged.quantity = prev.quantity;
        merged.inventoryItemId = prev.inventoryItemId;
        merged.locationId = prev.locationId;
      }
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

    const errorParts: string[] = [];

    // 1) Product-level fields.
    const productInput: Record<string, any> = { id: productId };
    if ('title' in merged) productInput.title = merged.title;
    if ('descriptionHtml' in merged) productInput.descriptionHtml = merged.descriptionHtml ?? '';
    if ('vendor' in merged) productInput.vendor = merged.vendor ?? '';
    if ('status' in merged && merged.status) productInput.status = String(merged.status).toUpperCase();
    if ('productType' in merged) productInput.productType = merged.productType ?? '';
    if ('tags' in merged) productInput.tags = Array.isArray(merged.tags) ? merged.tags : [];
    if ('seo' in merged && merged.seo) {
      productInput.seo = {
        title: merged.seo.title ?? '',
        description: merged.seo.description ?? '',
      };
    }
    if ('handle' in merged && merged.handle) productInput.handle = merged.handle;
    if ('category' in merged) productInput.category = merged.category ?? null;

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
    if (merged?.price !== null && merged?.price !== undefined && merged?.variantId) {
      try {
        const d: any = await shopifyGraphQL(shop, accessToken, VARIANT_PRICE_UPDATE, {
          productId,
          variants: [{ id: merged.variantId, price: String(merged.price) }],
        });
        const err = firstError(d?.productVariantsBulkUpdate?.userErrors);
        if (err) errorParts.push(`price: ${err}`);
      } catch (e: any) {
        errorParts.push(`price: ${e?.message ?? 'error'}`);
      }
    }

    // 3) Quantity / inventory.
    if (merged?.quantity !== null && merged?.quantity !== undefined && merged?.inventoryItemId) {
      let locationId: string | null = merged?.locationId ?? null;
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
                  inventoryItemId: merged.inventoryItemId,
                  locationId,
                  quantity: Number(merged.quantity),
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

    // Mark every reverted edit as undone.
    const ids = revertible.map((e) => e.id);
    await prisma.editLog
      .updateMany({ where: { id: { in: ids } }, data: { undone: true, undoneAt: new Date() } })
      .catch(() => null);

    return NextResponse.json({ success: true, productId, revertedIds: ids, reverted: ids.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Restore failed' }, { status: 500 });
  }
}
