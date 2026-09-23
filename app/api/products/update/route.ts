import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { getPlanInfo } from '@/lib/billing';
import { prisma } from '@/lib/db';
import { incrementUsage } from '@/lib/usage';

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

const INV_ITEM_UPDATE = `
  mutation InvItem($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem { id tracked }
      userErrors { field message }
    }
  }
`;

const INV_ACTIVATE = `
  mutation InvActivate($inventoryItemId: ID!, $locationId: ID!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
      inventoryLevel { id }
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

type UpdateItem = {
  productId: string;
  title?: string | null;
  variantId?: string | null;
  inventoryItemId?: string | null;
  vendor?: string | null;
  price?: string | null;
  quantity?: number | null;
  status?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  // Previous values captured client-side so we can offer Undo.
  prevVendor?: string | null;
  prevPrice?: string | null;
  prevQuantity?: number | null;
  prevStatus?: string | null;
  prevProductType?: string | null;
  prevTags?: string[] | null;
};

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
    const updates: UpdateItem[] = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
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
    if (planInfo.productLimit !== null && updates.length > planInfo.productLimit) {
      return NextResponse.json(
        {
          error: `limit_exceeded`,
          message: `Your ${planInfo.planName} plan allows editing up to ${planInfo.productLimit} products at a time. Upgrade to edit more.`,
          productLimit: planInfo.productLimit,
          upgradeUrl: planInfo.upgradeUrl,
        },
        { status: 402 },
      );
    }

    // Resolve primary location once (needed for inventory changes).
    let locationId: string | null = null;
    const needsInventory = updates.some((u) => u?.quantity !== null && u?.quantity !== undefined);
    if (needsInventory) {
      try {
        const locData: any = await shopifyGraphQL(shop, accessToken, LOCATION_QUERY);
        locationId = locData?.locations?.edges?.[0]?.node?.id ?? null;
      } catch {
        locationId = null;
      }
    }

    const results: any[] = [];

    for (const u of updates) {
      const productId = u?.productId;
      if (!productId) {
        results.push({ productId: productId ?? '', success: false, error: 'Missing product id' });
        continue;
      }
      const changeSummary: Record<string, any> = {};
      const previous: Record<string, any> = {};
      const errorParts: string[] = [];

      // 1) Product-level fields (vendor, status, product type, tags) in one update.
      const productInput: Record<string, any> = { id: productId };
      const productChanges: Record<string, any> = {};
      if (u?.vendor !== null && u?.vendor !== undefined && u.vendor !== '') {
        productInput.vendor = u.vendor;
        productChanges.vendor = u.vendor;
      }
      if (u?.status !== null && u?.status !== undefined && u.status !== '') {
        productInput.status = String(u.status).toUpperCase();
        productChanges.status = productInput.status;
      }
      if (u?.productType !== null && u?.productType !== undefined && u.productType !== '') {
        productInput.productType = u.productType;
        productChanges.productType = u.productType;
      }
      if (Array.isArray(u?.tags)) {
        productInput.tags = u.tags;
        productChanges.tags = u.tags;
      }
      if (Object.keys(productInput).length > 1) {
        try {
          const d: any = await shopifyGraphQL(shop, accessToken, PRODUCT_UPDATE, {
            product: productInput,
          });
          const err = firstError(d?.productUpdate?.userErrors);
          if (err) errorParts.push(`fields: ${err}`);
          else {
            Object.assign(changeSummary, productChanges);
            if ('vendor' in productChanges) previous.vendor = u?.prevVendor ?? null;
            if ('status' in productChanges) previous.status = u?.prevStatus ?? null;
            if ('productType' in productChanges) previous.productType = u?.prevProductType ?? null;
            if ('tags' in productChanges) previous.tags = Array.isArray(u?.prevTags) ? u.prevTags : [];
          }
        } catch (e: any) {
          errorParts.push(`fields: ${e?.message ?? 'error'}`);
        }
      }

      // 2) Price
      if (u?.price !== null && u?.price !== undefined && u.price !== '' && u?.variantId) {
        try {
          const d: any = await shopifyGraphQL(shop, accessToken, VARIANT_PRICE_UPDATE, {
            productId,
            variants: [{ id: u.variantId, price: String(u.price) }],
          });
          const err = firstError(d?.productVariantsBulkUpdate?.userErrors);
          if (err) errorParts.push(`price: ${err}`);
          else {
            changeSummary.price = u.price;
            previous.price = u?.prevPrice ?? null;
            previous.variantId = u?.variantId ?? null;
          }
        } catch (e: any) {
          errorParts.push(`price: ${e?.message ?? 'error'}`);
        }
      }

      // 3) Quantity / inventory
      const wantsQuantity = u?.quantity !== null && u?.quantity !== undefined;
      if (wantsQuantity && !u?.inventoryItemId) {
        errorParts.push('quantity: missing inventory item id for this product');
      } else if (wantsQuantity && !locationId) {
        errorParts.push('quantity: no active store location found');
      } else if (wantsQuantity && u?.inventoryItemId && locationId) {
        try {
          // Ensure the item is tracked.
          await shopifyGraphQL(shop, accessToken, INV_ITEM_UPDATE, {
            id: u.inventoryItemId,
            input: { tracked: true },
          }).catch(() => null);
          // Ensure it is stocked at the location (idempotent-ish).
          await shopifyGraphQL(shop, accessToken, INV_ACTIVATE, {
            inventoryItemId: u.inventoryItemId,
            locationId,
          }).catch(() => null);
          // Set the available quantity.
          const d: any = await shopifyGraphQL(shop, accessToken, INV_SET, {
            input: {
              name: 'available',
              reason: 'correction',
              ignoreCompareQuantity: true,
              quantities: [
                {
                  inventoryItemId: u.inventoryItemId,
                  locationId,
                  quantity: Number(u.quantity),
                },
              ],
            },
          });
          const err = firstError(d?.inventorySetQuantities?.userErrors);
          if (err) errorParts.push(`quantity: ${err}`);
          else {
            changeSummary.quantity = Number(u.quantity);
            if (u?.prevQuantity !== null && u?.prevQuantity !== undefined) previous.quantity = Number(u.prevQuantity);
            previous.inventoryItemId = u?.inventoryItemId ?? null;
            previous.locationId = locationId;
          }
        } catch (e: any) {
          errorParts.push(`quantity: ${e?.message ?? 'error'}`);
        }
      }

      const success = errorParts.length === 0;
      const errorMsg = errorParts.length > 0 ? errorParts.join(' | ') : null;
      results.push({ productId, success, error: errorMsg, changes: changeSummary });

      await prisma.editLog
        .create({
          data: {
            shop,
            productId,
            productTitle: u?.title ?? null,
            changes: JSON.stringify(changeSummary),
            previousValues: JSON.stringify(previous),
            success,
            errorMsg,
          },
        })
        .catch(() => null);
    }

    const successCount = results.filter((r) => r?.success).length;
    await incrementUsage(shop, successCount);

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Update failed' }, { status: 500 });
  }
}
