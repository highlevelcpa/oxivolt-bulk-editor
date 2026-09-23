import { prisma } from '@/lib/db';

// Current calendar month in UTC as "YYYY-MM".
export function currentPeriod(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Increment the monthly processed-products counter for a shop.
// Best-effort: never throws (usage tracking must not break an edit operation).
export async function incrementUsage(shop: string, n: number): Promise<void> {
  if (!shop || !n || n <= 0) return;
  const period = currentPeriod();
  try {
    await prisma.usageCounter.upsert({
      where: { shop_period: { shop, period } },
      create: { shop, period, count: n },
      update: { count: { increment: n } },
    });
  } catch {
    // non-fatal
  }
}

// Read the current month's usage for a shop.
export async function getUsage(shop: string): Promise<{ period: string; count: number }> {
  const period = currentPeriod();
  try {
    const row = await prisma.usageCounter.findUnique({
      where: { shop_period: { shop, period } },
    });
    return { period, count: row?.count ?? 0 };
  } catch {
    return { period, count: 0 };
  }
}
