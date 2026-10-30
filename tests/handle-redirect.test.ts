// Regression tests: whenever the app changes a product handle (AI SEO / Run all,
// and restoring the original handle), productUpdate must ask Shopify to create a
// URL redirect (ProductUpdateInput.redirectNewHandle) so old links don't 404.
// Shopify Admin GraphQL, Gemini and Prisma are mocked; no network, no real store.
//
// Run: node --import tsx --test tests/*.test.ts
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const SHOP = 'test-shop.myshopify.com';
process.env.SHOPIFY_API_KEY = API_KEY;
process.env.SHOPIFY_API_SECRET = API_SECRET;
process.env.GEMINI_API_KEY = 'fake-gemini-key';
delete process.env.ABACUS_API_KEY;
delete process.env.ABACUSAI_API_KEY;

const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const geminiText = (obj: any) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

let geminiReply: any = {};
let updates: any[] = [];
let editLogRows: any[] = [];

(globalThis as any).fetch = async (url: any, init: any) => {
  const href = String(url);
  if (href.includes('generativelanguage.googleapis.com')) return geminiText(geminiReply);
  if (href.includes('apps.abacus.ai')) throw new Error('abacus must not be called in tests');
  assert.ok(href.startsWith(`https://${SHOP}/admin/api/2026-04/graphql.json`), `unexpected fetch ${href}`);
  const body = JSON.parse(init?.body ?? '{}');
  const q: string = body.query;
  if (q.includes('shop { id }')) return json({ data: { shop: { id: 'gid://shopify/Shop/1' } } });
  if (q.includes('currentAppInstallation')) {
    return json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', name: 'Pro', status: 'ACTIVE', lineItems: [] }] } } });
  }
  if (q.includes('nodes(')) {
    return json({ data: { nodes: body.variables.ids.map((id: string) => ({ id, title: 'Old', handle: 'old-handle', tags: [], seo: { title: null, description: null }, descriptionHtml: '<p>x</p>' })) } });
  }
  if (q.includes('productUpdate(')) {
    updates.push(body.variables.product);
    return json({ data: { productUpdate: { product: { id: body.variables.product.id }, userErrors: [] } } });
  }
  return json({ errors: [{ message: 'unexpected query in test' }] });
};

(globalThis as any).prisma = {
  shopSession: {
    findUnique: async () => ({ shop: SHOP, accessToken: 'fake-token', tokenExpiresAt: new Date(Date.now() + 3600_000) }),
    upsert: async () => ({}),
  },
  shopBilling: { findUnique: async () => null, upsert: async () => ({}) },
  editLog: {
    create: async ({ data }: any) => data,
    findMany: async () => editLogRows,
    updateMany: async () => ({ count: editLogRows.length }),
  },
  usageCounter: { upsert: async () => ({}) },
};

let enhancePOST: (req: any) => Promise<Response>;
let restorePOST: (req: any) => Promise<Response>;
let NextRequestCtor: any;
before(async () => {
  NextRequestCtor = (await import('next/server')).NextRequest;
  enhancePOST = (await import('../app/api/products/enhance/route')).POST;
  restorePOST = (await import('../app/api/products/restore/route')).POST;
});
beforeEach(() => {
  updates = [];
  editLogRows = [];
  geminiReply = {};
});

const req = (path: string, body: any) =>
  new NextRequestCtor(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt.sign({ aud: API_KEY, dest: `https://${SHOP}` }, API_SECRET, { algorithm: 'HS256' })}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

test('SEO mode: a new handle is sent with redirectNewHandle=true', async () => {
  geminiReply = { title: 'Meta', description: 'Desc', handle: 'new-handle' };
  const res = await enhancePOST(req('/api/products/enhance', { productIds: ['gid://shopify/Product/1'], mode: 'seo' }));
  assert.equal((await res.json()).results[0].success, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].handle, 'new-handle');
  assert.equal(updates[0].redirectNewHandle, true);
});

test('Run all mode: a new handle is sent with redirectNewHandle=true', async () => {
  geminiReply = { title: 'New', html: '<p>d</p>', seoTitle: 'S', seoDescription: 'D', handle: 'brand-new', tags: [] };
  await enhancePOST(req('/api/products/enhance', { productIds: ['gid://shopify/Product/1'], mode: 'all' }));
  assert.equal(updates[0].handle, 'brand-new');
  assert.equal(updates[0].redirectNewHandle, true);
});

test('SEO mode: an unchanged handle does not request a redirect', async () => {
  geminiReply = { title: 'Meta', description: 'Desc', handle: 'old-handle' };
  await enhancePOST(req('/api/products/enhance', { productIds: ['gid://shopify/Product/1'], mode: 'seo' }));
  assert.equal(updates[0].handle, 'old-handle');
  assert.equal('redirectNewHandle' in updates[0], false);
});

test('description/title modes never touch the handle or request a redirect', async () => {
  geminiReply = { html: '<p>d</p>', title: 'T' };
  await enhancePOST(req('/api/products/enhance', { productIds: ['gid://shopify/Product/1'], mode: 'description' }));
  await enhancePOST(req('/api/products/enhance', { productIds: ['gid://shopify/Product/1'], mode: 'title' }));
  assert.equal(updates.length, 2);
  for (const u of updates) {
    assert.equal('handle' in u, false);
    assert.equal('redirectNewHandle' in u, false);
  }
});

test('restore: restoring the original handle requests a redirect from the AI handle', async () => {
  editLogRows = [{
    id: 'log1', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
    changes: JSON.stringify({ urlHandle: 'new-handle' }),
    previousValues: JSON.stringify({ seo: { title: null, description: null }, handle: 'old-handle' }),
  }];
  const res = await restorePOST(req('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  assert.equal(res.status, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].handle, 'old-handle');
  assert.equal(updates[0].redirectNewHandle, true);
});

test('restore without a handle in the snapshot does not request a redirect', async () => {
  editLogRows = [{
    id: 'log2', shop: SHOP, productId: 'gid://shopify/Product/1', success: true, undone: false,
    changes: JSON.stringify({ title: 'New' }),
    previousValues: JSON.stringify({ title: 'Old' }),
  }];
  await restorePOST(req('/api/products/restore', { productId: 'gid://shopify/Product/1' }));
  assert.equal(updates[0].title, 'Old');
  assert.equal('redirectNewHandle' in updates[0], false);
});
