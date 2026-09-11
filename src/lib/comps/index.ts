import type { Currency, Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRateForDate } from "@/lib/fx";
import { makeMoney, type Money } from "@/lib/currency";
import { EbayApiCompProvider } from "./providers/ebayApi";
import { ManualCompProvider } from "./providers/manual";
import {
  CompProviderError,
  type CompProvider,
  type CompQuery,
  type ProviderAmount,
} from "./types";

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

/**
 * Converts a provider's single-currency amount into the stored USD/JPY pair,
 * using the rate for the date the item sold.
 */
async function toMoney(
  amount: ProviderAmount | null | undefined,
  soldAt: Date | null | undefined,
): Promise<Money | null> {
  if (!amount) return null;

  const side =
    amount.currency === "JPY"
      ? { jpyYen: amount.amountMinor }
      : { usdCents: amount.amountMinor };

  try {
    const rate = await getRateForDate(soldAt ?? new Date());
    return makeMoney(side, rate.jpyPerUsd, amount.currency);
  } catch {
    // No rate available — keep the side we actually know rather than lose it.
    return { usdCents: side.usdCents ?? 0, jpyYen: side.jpyYen ?? 0 };
  }
}

export type RunSearchOptions = {
  /** Re-fetch even if a fresh cached search exists. */
  force?: boolean;
};

/**
 * Runs a comp search through the configured provider, persisting results.
 *
 * Manually-corrected prices live on the SoldComp rows, so a refresh must not
 * blindly wipe them: we carry the manual price across by externalId.
 *
 * The cache is per user. Two accounts researching the same card each get their
 * own row, because a search carries hand-entered comps and hand-corrected Best
 * Offer prices that belong to whoever did that research.
 */
export async function runCompSearch(
  userId: string,
  query: CompQuery,
  options: RunSearchOptions = {},
): Promise<{ searchId: string; warning: string | null; fromCache: boolean }> {
  const provider = getProvider();
  const cacheKey = buildCacheKey(query, provider.id);

  const existing = await prisma.compSearch.findUnique({
    where: { userId_cacheKey: { userId, cacheKey } },
    include: { comps: true },
  });

  const ttlMs = cacheMinutes() * 60 * 1000;
  const isFresh = existing !== null && Date.now() - existing.fetchedAt.getTime() < ttlMs;

  if (existing && isFresh && !options.force) {
    return { searchId: existing.id, warning: existing.warning, fromCache: true };
  }

  // Preserve any prices the user corrected by hand on a previous run.
  const manualByKey = new Map<string, { usd: number | null; jpy: number | null }>();
  for (const comp of existing?.comps ?? []) {
    if (comp.manualPriceUsdCents !== null || comp.manualPriceJpyYen !== null) {
      manualByKey.set(comp.externalId ?? comp.title, {
        usd: comp.manualPriceUsdCents,
        jpy: comp.manualPriceJpyYen,
      });
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
    where: { userId_cacheKey: { userId, cacheKey } },
    create: {
      userId,
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
    const rows = [];
    for (const r of results) {
      const salePrice = await toMoney(r.salePrice, r.soldAt);
      if (!salePrice) continue;
      const listedPrice = await toMoney(r.listedPrice, r.soldAt);
      const shipping = await toMoney(r.shipping, r.soldAt);
      const manual = manualByKey.get(r.externalId ?? r.title);

      rows.push({
        searchId: search.id,
        externalId: r.externalId ?? null,
        title: r.title,
        url: r.url ?? null,
        imageUrl: r.imageUrl ?? null,
        soldAt: r.soldAt ?? null,
        currency: r.salePrice.currency as Currency,
        salePriceUsdCents: salePrice.usdCents,
        salePriceJpyYen: salePrice.jpyYen,
        listedPriceUsdCents: listedPrice?.usdCents ?? null,
        listedPriceJpyYen: listedPrice?.jpyYen ?? null,
        shippingUsdCents: shipping?.usdCents ?? null,
        shippingJpyYen: shipping?.jpyYen ?? null,
        wasBestOffer: r.wasBestOffer ?? false,
        priceIsConfirmed: r.priceIsConfirmed,
        manualPriceUsdCents: manual?.usd ?? null,
        manualPriceJpyYen: manual?.jpy ?? null,
        grader: r.grader ?? null,
        grade: r.grade ?? null,
        condition: r.condition ?? null,
        provider: provider.id,
      });
    }

    // Replace only provider-sourced rows; hand-added comps are kept.
    await prisma.soldComp.deleteMany({
      where: { searchId: search.id, provider: { not: "manual-entry" } },
    });
    if (rows.length > 0) {
      await prisma.soldComp.createMany({ data: rows as never });
    }
  }

  return { searchId: search.id, warning, fromCache: false };
}

type CompPriceFields = {
  manualPriceUsdCents: number | null;
  manualPriceJpyYen: number | null;
  salePriceUsdCents: number;
  salePriceJpyYen: number;
};

/** The price to trust for a comp: a hand-entered correction wins. */
export function effectivePrice(comp: CompPriceFields): Money {
  if (comp.manualPriceUsdCents !== null || comp.manualPriceJpyYen !== null) {
    return {
      usdCents: comp.manualPriceUsdCents ?? 0,
      jpyYen: comp.manualPriceJpyYen ?? 0,
    };
  }
  return { usdCents: comp.salePriceUsdCents, jpyYen: comp.salePriceJpyYen };
}

export type CompStats = {
  count: number;
  confirmedCount: number;
  unconfirmedCount: number;
  min: Money;
  max: Money;
  median: Money;
  mean: Money;
};

function stat(values: number[], pick: "min" | "max" | "median" | "mean"): number {
  const sorted = [...values].sort((a, b) => a - b);
  switch (pick) {
    case "min":
      return sorted[0];
    case "max":
      return sorted[sorted.length - 1];
    case "mean":
      return Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
    case "median": {
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
    }
  }
}

/**
 * Summary stats over comps, in both currencies. Only confirmed prices are
 * included — an unresolved Best Offer asking price would bias every number up.
 *
 * Each currency is ranked independently, so the USD median and the JPY median
 * can come from different listings when rates moved between sale dates. That is
 * intentional: each is the correct median in its own currency.
 */
export function summarizeComps(
  comps: Array<CompPriceFields & { priceIsConfirmed: boolean }>,
): CompStats | null {
  const usable = comps.filter(
    (c) => c.priceIsConfirmed || c.manualPriceUsdCents !== null || c.manualPriceJpyYen !== null,
  );
  if (usable.length === 0) return null;

  const prices = usable.map(effectivePrice);
  const usd = prices.map((p) => p.usdCents);
  const jpy = prices.map((p) => p.jpyYen);

  return {
    count: comps.length,
    confirmedCount: usable.length,
    unconfirmedCount: comps.length - usable.length,
    min: { usdCents: stat(usd, "min"), jpyYen: stat(jpy, "min") },
    max: { usdCents: stat(usd, "max"), jpyYen: stat(jpy, "max") },
    median: { usdCents: stat(usd, "median"), jpyYen: stat(jpy, "median") },
    mean: { usdCents: stat(usd, "mean"), jpyYen: stat(jpy, "mean") },
  };
}

export type { CompQuery };
export type CompFilters = {
  query: string;
  itemType?: ItemType | null;
  grader?: Grader | null;
  grade?: string | null;
};
