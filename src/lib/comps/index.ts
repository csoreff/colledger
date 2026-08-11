import type { Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EbayApiCompProvider } from "./providers/ebayApi";
import { ManualCompProvider } from "./providers/manual";
import { CompProviderError, type CompProvider, type CompQuery } from "./types";

const PROVIDERS: Record<string, CompProvider> = {
  "ebay-api": new EbayApiCompProvider(),
  manual: new ManualCompProvider(),
};

export function getProvider(): CompProvider {
  const configured = process.env.COMP_PROVIDER ?? "ebay-api";
  return PROVIDERS[configured] ?? PROVIDERS.manual;
}

export function listProviders(): CompProvider[] {
  return Object.values(PROVIDERS);
}

export function cacheMinutes(): number {
  const parsed = Number(process.env.COMP_CACHE_MINUTES);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 720;
}

/** Stable cache key so identical searches reuse stored results. */
export function buildCacheKey(query: CompQuery, providerId: string): string {
  return [
    providerId,
    query.query.trim().toLowerCase().replace(/\s+/g, " "),
    query.itemType ?? "ANY",
    query.grader ?? "ANY",
    (query.grade ?? "").toLowerCase(),
  ].join("|");
}

export type RunSearchOptions = {
  /** Re-fetch even if a fresh cached search exists. */
  force?: boolean;
};

/**
 * Runs a comp search through the configured provider, persisting results.
 *
 * Manually-corrected prices live on the SoldComp rows, so a refresh must not
 * blindly wipe them: we carry `manualPriceCents` across by externalId.
 */
export async function runCompSearch(
  query: CompQuery,
  options: RunSearchOptions = {},
): Promise<{ searchId: string; warning: string | null; fromCache: boolean }> {
  const provider = getProvider();
  const cacheKey = buildCacheKey(query, provider.id);

  const existing = await prisma.compSearch.findUnique({
    where: { cacheKey },
    include: { comps: true },
  });

  const ttlMs = cacheMinutes() * 60 * 1000;
  const isFresh =
    existing !== null && Date.now() - existing.fetchedAt.getTime() < ttlMs;

  if (existing && isFresh && !options.force) {
    return { searchId: existing.id, warning: existing.warning, fromCache: true };
  }

  // Preserve any prices the user corrected by hand on a previous run.
  const manualByKey = new Map<string, number>();
  for (const comp of existing?.comps ?? []) {
    if (comp.manualPriceCents !== null) {
      manualByKey.set(comp.externalId ?? comp.title, comp.manualPriceCents);
    }
  }

  let results: Awaited<ReturnType<CompProvider["search"]>>["results"] = [];
  let warning: string | null = null;

  try {
    const response = await provider.search(query);
    results = response.results;
    warning = response.warning ?? null;
  } catch (error) {
    if (error instanceof CompProviderError) {
      // A provider failure shouldn't destroy cached comps or block manual entry;
      // surface it and keep whatever we already had.
      warning = error.message;
      if (existing) {
        await prisma.compSearch.update({
          where: { id: existing.id },
          data: { warning, fetchedAt: new Date() },
        });
        return { searchId: existing.id, warning, fromCache: true };
      }
      results = [];
    } else {
      throw error;
    }
  }

  const search = await prisma.compSearch.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      query: query.query.trim(),
      itemType: query.itemType ?? null,
      grader: query.grader ?? null,
      grade: query.grade ?? null,
      provider: provider.id,
      resultCount: results.length,
      warning,
    },
    update: {
      provider: provider.id,
      fetchedAt: new Date(),
      resultCount: results.length,
      warning,
    },
  });

  if (results.length > 0) {
    // Replace only provider-sourced rows; hand-added comps are kept.
    await prisma.soldComp.deleteMany({
      where: { searchId: search.id, provider: { not: "manual-entry" } },
    });

    await prisma.soldComp.createMany({
      data: results.map((r) => ({
        searchId: search.id,
        externalId: r.externalId ?? null,
        title: r.title,
        url: r.url ?? null,
        imageUrl: r.imageUrl ?? null,
        soldAt: r.soldAt ?? null,
        salePriceCents: r.salePriceCents,
        listedPriceCents: r.listedPriceCents ?? null,
        shippingCents: r.shippingCents ?? null,
        currency: r.currency ?? "USD",
        wasBestOffer: r.wasBestOffer ?? false,
        priceIsConfirmed: r.priceIsConfirmed,
        manualPriceCents: manualByKey.get(r.externalId ?? r.title) ?? null,
        grader: r.grader ?? null,
        grade: r.grade ?? null,
        condition: r.condition ?? null,
        provider: provider.id,
      })),
    });
  }

  return { searchId: search.id, warning, fromCache: false };
}

/** The price to trust for a comp: a hand-entered correction wins. */
export function effectivePriceCents(comp: {
  manualPriceCents: number | null;
  salePriceCents: number;
}): number {
  return comp.manualPriceCents ?? comp.salePriceCents;
}

export type CompStats = {
  count: number;
  confirmedCount: number;
  unconfirmedCount: number;
  minCents: number;
  maxCents: number;
  medianCents: number;
  meanCents: number;
};

/**
 * Summary stats over comps. Only confirmed prices are included — an unresolved
 * Best Offer asking price would bias every number upward.
 */
export function summarizeComps(
  comps: Array<{
    manualPriceCents: number | null;
    salePriceCents: number;
    priceIsConfirmed: boolean;
  }>,
): CompStats | null {
  const usable = comps.filter((c) => c.priceIsConfirmed || c.manualPriceCents !== null);
  const prices = usable.map(effectivePriceCents).sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const mid = Math.floor(prices.length / 2);
  const medianCents =
    prices.length % 2 === 0
      ? Math.round((prices[mid - 1] + prices[mid]) / 2)
      : prices[mid];

  return {
    count: comps.length,
    confirmedCount: prices.length,
    unconfirmedCount: comps.length - prices.length,
    minCents: prices[0],
    maxCents: prices[prices.length - 1],
    medianCents,
    meanCents: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
  };
}

export type { CompQuery };
export type CompFilters = {
  query: string;
  itemType?: ItemType | null;
  grader?: Grader | null;
  grade?: string | null;
};
