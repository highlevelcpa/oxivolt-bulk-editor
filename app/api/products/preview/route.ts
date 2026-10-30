import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, verifySessionToken } from '@/lib/shopify';
import { validateUpdateRequest } from '@/lib/update-validate';
import { signPreviewToken } from '@/lib/preview-token';

export const dynamic = 'force-dynamic';

// Max apply-batches per preview call. The client previews in groups of batches, so this
// bounds the request size (MAX_PREVIEW_CHUNKS x MAX_UPDATES_PER_REQUEST items at most).
const MAX_PREVIEW_CHUNKS = 20;

// POST /api/products/preview  body: { chunks: UpdateItem[][] }
//
// Validates every batch with exactly the same rules as /api/products/update and, only if
// EVERY item in EVERY batch is valid, returns one signed preview token per batch. The
// client must send each batch to /api/products/update unchanged together with its token.
// No Shopify call, no database write, no usage counted.
export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    const shop = verifySessionToken(token);
    if (!shop || !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: any = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }
    const extra = Object.keys(body).filter((k) => k !== 'chunks');
    if (extra.length > 0) {
      return NextResponse.json(
        { error: `Unsupported request field(s): ${extra.slice(0, 5).join(', ').slice(0, 200)}`, code: 'unsupported_field' },
        { status: 400 },
      );
    }
    const chunks = body.chunks;
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }
    if (chunks.length > MAX_PREVIEW_CHUNKS) {
      return NextResponse.json(
        { error: `Too many batches in one preview (max ${MAX_PREVIEW_CHUNKS})`, code: 'too_many_updates' },
        { status: 400 },
      );
    }

    const checked = chunks.map((c: unknown) => validateUpdateRequest({ updates: c }));
    // A product may appear only once across the whole preview.
    const seen = new Set<string>();
    let duplicate: string | null = null;
    for (const v of checked) {
      if (!v.ok) continue;
      for (const item of v.items) {
        if (seen.has(item.productId)) duplicate = duplicate ?? item.productId;
        seen.add(item.productId);
      }
    }
    const firstBad = checked.find((v) => !v.ok);
    if (firstBad || duplicate) {
      return NextResponse.json(
        {
          error: firstBad && !firstBad.ok ? firstBad.body.error : 'Duplicate product in this preview; nothing was changed.',
          code: firstBad && !firstBad.ok ? (firstBad.body.code ?? 'invalid_updates') : 'invalid_updates',
          chunks: checked.map((v) => (v.ok ? { ok: true } : { ok: false, ...v.body })),
        },
        { status: 400 },
      );
    }

    let expiresAt = 0;
    const out = checked.map((v) => {
      if (!v.ok) throw new Error('unreachable');
      const signed = signPreviewToken(shop, v.updates);
      expiresAt = signed.expiresAt;
      return { previewToken: signed.token, count: v.items.length };
    });
    return NextResponse.json({ chunks: out, expiresAt });
  } catch (e: any) {
    console.error('[products/preview] failed:', e?.name ?? 'Error');
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
  }
}
