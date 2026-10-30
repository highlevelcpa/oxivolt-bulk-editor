// Regression tests for GET /api/products pagination: the response must say when
// the page cap was reached so the UI can warn that the list is incomplete.
// Shopify Admin GraphQL and Prisma are mocked; no network, no real store.
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

const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

let catalogSize = 0;
let productPageCalls = 0;

(globalThis as any).fetch = async (url: any, init: any) => {
  const href = String(url);
  assert.ok(href.startsWith(`https://${SHOP}/admin/api/2026-04/graphql.json`), `unexpected fetch ${href}`);
  const body = JSON.parse(init?.body ?? '{}');
  const q: string = body.query;
  if (q.includes('shop { id }')) return json({ data: { shop: { id: 'gid://shopify/Shop/1' } } });
  if (q.includes('currentAppInstallation')) {
    return json({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', activeSubscriptions: [{ id: 'gid://shopify/AppSubscription/1', name: 'Pro', status: 'ACTIVE', lineItems: [] }] } } });
  }
  if (q.includes('products(first: 100')) {
    productPageCalls++;
    const start = body.variables.cursor ? Number(body.variables.cursor) : 0;
    const end = Math.min(start + 100, catalogSize);
    const edges = [];
    for (let i = start; i < end; i++) {
      edges.push({ node: { id: `gid://shopify/Product/${i + 1}`, title: `P${i + 1}`, variants: { edges: [] } } });
    }
    return json({ data: { products: { pageInfo: { hasNextPage: end < catalogSize, endCursor: String(end) }, edges } } });
  }
  return json({ errors: [{ message: 'unexpected query in test' }] });
};

(globalThis as any).prisma = {
  shopSession: {
    findUnique: async () => ({ shop: SHOP, accessToken: 'fake-token', tokenExpiresAt: new Date(Date.now() + 3600_000) }),
    upsert: async () => ({}),
  },
  shopBilling: { findUnique: async () => null, upsert: async () => ({}) },
};

let productsGET: (req: any) => Promise<Response>;
let NextRequestCtor: any;
before(async () => {
  NextRequestCtor = (await import('next/server')).NextRequest;
  productsGET = (await import('../app/api/products/route')).GET;
});
beforeEach(() => {
  productPageCalls = 0;
});

async function load(size: number) {
  catalogSize = size;
  const token = jwt.sign({ aud: API_KEY, dest: `https://${SHOP}` }, API_SECRET, { algorithm: 'HS256' });
  const res = await productsGET(new NextRequestCtor('http://localhost/api/products', { headers: { authorization: `Bearer ${token}` } }));
  return { status: res.status, body: await res.json() };
}

test('small catalog: all products loaded, truncated=false', async () => {
  const { status, body } = await load(250);
  assert.equal(status, 200);
  assert.equal(body.count, 250);
  assert.equal(body.truncated, false);
  assert.equal(productPageCalls, 3);
});

test('catalog of exactly 3,000 products: complete, truncated=false', async () => {
  const { body } = await load(3000);
  assert.equal(body.count, 3000);
  assert.equal(body.truncated, false);
  assert.equal(productPageCalls, 30);
});

test('catalog larger than the 3,000 cap: stops at 30 pages and reports truncated=true', async () => {
  const { body } = await load(3001);
  assert.equal(body.count, 3000);
  assert.equal(body.truncated, true);
  assert.equal(productPageCalls, 30, 'page cap still enforced');
});

test('empty store: no products, truncated=false', async () => {
  const { body } = await load(0);
  assert.equal(body.count, 0);
  assert.deepEqual(body.products, []);
  assert.equal(body.truncated, false);
});
