import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL, publicShopifyError } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { limitExceededResponse, requireActivePlan } from '@/lib/billing-guard';
import { prisma } from '@/lib/db';
import {
  INV_SET_QUANTITIES,
  QUANTITY_SCOPE_LOCATION,
  inventorySetVariables,
  isStaleQuantityError,
  readAvailable,
} from '@/lib/inventory';
import { incrementUsage } from '@/lib/usage';
import { validateUpdateRequest } from '@/lib/update-validate';
import { verifyPreviewToken } from '@/lib/preview-token';

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

// `@idempotent(key:)` is optional on 2026-01 and required for inventoryActivate on 2026-04.
const INV_ACTIVATE = `
  mutation InvActivate($inventoryItemId: ID!, $locationId: ID!, $idempotencyKey: String!) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) @idempotent(key: $idempotencyKey) {
      inventoryLevel { id }
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

    // Validate every item BEFORE any Shopify call (including the token probe and billing
    // gate). All-or-nothing: any invalid item rejects the request with zero Shopify calls.
    const body = await req.json().catch(() => null);
    const validation = validateUpdateRequest(body, ['updates', 'previewToken']);
    if (!validation.ok) {
      return NextResponse.json(validation.body, { status: validation.status });
    }

    // Apply only what was previewed: the token must be for this shop, unexpired, and
    // match the exact submitted `updates` array (see lib/preview-token.ts).
    const preview = verifyPreviewToken((body as any).previewToken, shop, validation.updates);
    if (!preview.ok) {
      return NextResponse.json({ error: preview.error, code: preview.code }, { status: preview.status });
    }
    const updates = validation.items;

    let accessToken: string;
    try {
      accessToken = await getWorkingAccessToken(shop, token);
    } catch (e: any) {
      if (e instanceof ReauthRequiredError) {
        return NextResponse.json({ error: 'reauth_required' }, { status: 401 });
      }
      throw e;
    }

    // Billing gate + free-plan product limit (defense in depth; the UI also gates).
    const gate = await requireActivePlan(shop, accessToken);
    if (!gate.ok) return gate.response;
    const { planInfo } = gate;
    if (planInfo.productLimit !== null && updates.length > planInfo.productLimit) {
      return limitExceededResponse(planInfo, 'editing');
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

    // Iterate in request order so results[i] still corresponds to updates[i].
    for (const u of updates) {
      const productId = u.productId;
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
          errorParts.push(`fields: ${publicShopifyError(e)}`);
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
          errorParts.push(`price: ${publicShopifyError(e)}`);
        }
      }

      // 3) Quantity / inventory
      // (quantity and inventoryItemId were already validated in lib/update-validate.ts)
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
            idempotencyKey: randomUUID(),
          }).catch(() => null);
          // Read the real `available` quantity at THIS location. It is both the CAS guard
          // for the write and the authoritative Undo snapshot (the client's prevQuantity is
          // the variant total across all locations and may be stale).
          const before = await readAvailable(shop, accessToken, u.inventoryItemId, locationId);
          if (before === null) {
            errorParts.push('quantity: could not read current stock at the store location');
          } else {
            // Absolute set, guarded by changeFromQuantity (see lib/inventory.ts).
            const d: any = await shopifyGraphQL(
              shop,
              accessToken,
              INV_SET_QUANTITIES,
              inventorySetVariables(u.inventoryItemId, locationId, Number(u.quantity), before),
            );
            const errs = d?.inventorySetQuantities?.userErrors;
            const err = firstError(errs);
            if (isStaleQuantityError(errs)) {
              errorParts.push('quantity: stock changed while saving (e.g. a sale); not applied, please retry');
            } else if (err) errorParts.push(`quantity: ${err}`);
            else {
              changeSummary.quantity = Number(u.quantity);
              previous.quantity = before;
              previous.inventoryItemId = u?.inventoryItemId ?? null;
              previous.locationId = locationId;
              previous.quantityScope = QUANTITY_SCOPE_LOCATION;
            }
          }
        } catch (e: any) {
          errorParts.push(`quantity: ${publicShopifyError(e)}`);
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
    // Never echo internal error text (DB/driver messages, Shopify response bodies).
    console.error('[products/update] failed:', e?.name ?? 'Error');
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
