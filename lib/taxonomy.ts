import { shopifyGraphQL } from '@/lib/shopify';

// Searches Shopify's Standard Product Taxonomy to resolve a human search term
// (e.g. "Cross Body Bags") into a real TaxonomyCategory GID we can apply to a product.

const TAXONOMY_SEARCH = `
  query SearchCategories($search: String!) {
    taxonomy {
      categories(search: $search, first: 8) {
        nodes {
          id
          fullName
          name
          isLeaf
          isArchived
        }
      }
    }
  }
`;

export type TaxonomyCategory = {
  id: string;
  fullName: string;
  name: string;
  isLeaf: boolean;
};

// Module-scoped cache (term -> category). Many products share categories, so this
// dramatically cuts the number of taxonomy lookups within a warm serverless instance.
const cache = new Map<string, TaxonomyCategory | null>();

export async function findCategoryByTerm(
  shop: string,
  accessToken: string,
  term: string,
): Promise<TaxonomyCategory | null> {
  const key = (term || '').trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const data: any = await shopifyGraphQL(shop, accessToken, TAXONOMY_SEARCH, { search: term });
  const nodes: any[] = data?.taxonomy?.categories?.nodes ?? [];
  const active = nodes.filter((n) => n && !n.isArchived);

  // Prefer the most specific (leaf) category; fall back to the first active result.
  const leaf = active.find((n) => n.isLeaf);
  const chosen = leaf ?? active[0] ?? null;

  const result: TaxonomyCategory | null = chosen
    ? {
        id: chosen.id,
        fullName: chosen.fullName,
        name: chosen.name,
        isLeaf: Boolean(chosen.isLeaf),
      }
    : null;

  cache.set(key, result);
  return result;
}
