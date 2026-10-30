import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken, shopifyGraphQL, publicShopifyError } from '@/lib/shopify';
import { getWorkingAccessToken, ReauthRequiredError } from '@/lib/access-token';
import { requireActivePlan } from '@/lib/billing-guard';
import { prisma } from '@/lib/db';
import { QUANTITY_SCOPE_LOCATION, conflictMessage, revertQuantityGuarded } from '@/lib/inventory';
import { validateRevertBody } from '@/lib/update-validate';

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

    const parsed = validateRevertBody(await req.json().catch(() => null), 'restore');
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const productId = parsed.id;

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
    // The quantity Shopify should hold right now = the value written by the NEWEST open
    // edit that touched quantity. Used as the compare-and-swap guard below.
    // Every open quantity edit must target the same inventory item AND location, otherwise
    // that value is not comparable with the stock at the restore location.
    let lastWrittenQuantity: number | null = null;
    const quantityTargets = new Set<string>();
    for (const e of entries) {
      let q: unknown;
      try {
        q = JSON.parse(e.changes ?? '{}')?.quantity;
      } catch {
        continue; // unreadable `changes`: not a known quantity write
      }
      if (typeof q !== 'number') continue;
      lastWrittenQuantity = q;
      let p: any = null;
      try {
        p = JSON.parse(e.previousValues ?? '{}');
      } catch {
        p = null; // unknown target: counted as its own target so it can never match silently
      }
      quantityTargets.add(p ? `${p?.inventoryItemId ?? '?'}|${p?.locationId ?? '?'}` : `unreadable:${e.id}`);
    }
    // Not overridable: acceptCurrentQuantity is ignored here because no single "current"
    // value exists to confirm against. Checked before any Shopify call.
    if (quantityTargets.size > 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'inventory_target_mismatch',
          message:
            'The open edits for this product changed stock at different locations or variants, ' +
            'so it cannot be restored automatically. Nothing was restored. Adjust stock manually in Shopify.',
        },
        { status: 409 },
      );
    }
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
        merged.quantityScope = prev.quantityScope;
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

    const gate = await requireActivePlan(shop, accessToken);
    if (!gate.ok) return gate.response;

    const errorParts: string[] = [];

    // 0) Quantity / inventory FIRST, guarded by compare-and-swap: only restore if Shopify
    //    still holds the value our newest edit wrote. On conflict nothing at all is written.
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
        return NextResponse.json({ success: false, error: 'quantity: no active store location found' }, { status: 200 });
      }
      const inv = await revertQuantityGuarded(shop, accessToken, {
        inventoryItemId: merged.inventoryItemId,
        locationId,
        target: Number(merged.quantity),
        expected: lastWrittenQuantity,
        acceptCurrent: parsed.acceptCurrentQuantity,
        legacySnapshot: merged.quantityScope !== QUANTITY_SCOPE_LOCATION,
      });
      if (!inv.ok && 'conflict' in inv) {
        return NextResponse.json(
          { success: false, error: 'inventory_conflict', message: conflictMessage(inv.conflict), conflict: inv.conflict },
          { status: 409 },
        );
      }
      if (!inv.ok) {
        return NextResponse.json({ success: false, error: inv.error }, { status: 200 });
      }
    }

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
        errorParts.push(`fields: ${publicShopifyError(e)}`);
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
        errorParts.push(`price: ${publicShopifyError(e)}`);
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
    // Never echo internal error text (DB/driver messages, Shopify response bodies).
    console.error('[products/restore] failed:', e?.name ?? 'Error');
    return NextResponse.json({ error: 'Restore failed' }, { status: 500 });
  }
}
