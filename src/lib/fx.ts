// Server-side only: it reads the FxRate cache through Prisma, which cannot run
// in the browser. Deliberately not guarded with the `server-only` package —
// that throws outside Next's bundler and would make this untestable in a script.
import type { Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/dates";
import type { RateTable } from "@/lib/currency";

/**
 * Historical USD->JPY rates, from the ECB series via frankfurter.dev (free, no
 * key). Rates are cached per requested date, so each transaction date is only
 * ever fetched once.
 *
 * Three properties of the upstream data shape the handling here:
 *  - There are no weekend or holiday rates. Asking for a Sunday returns the
 *    previous business day, and we record which date the number came from.
 *  - The series runs from 1999-01-04 to the last published business day.
 *    Anything outside that range is a clean 404.
 *  - The service occasionally returns a transient 5xx. That is NOT the same as
 *    "no rate exists", and conflating the two is how you end up pricing a 2020
 *    purchase at today's rate. Transient failures are retried, then fall back
 *    to the nearest *cached* rate — never to today's.
 */

const BASE_URL = "https://api.frankfurter.dev/v1";
/** Every non-USD currency the ledger supports, fetched in a single call. */
const SYMBOLS = "JPY,GBP,AUD";
const LATEST_URL = `${BASE_URL}/latest?base=USD&symbols=${SYMBOLS}`;
/** First day of the ECB reference series. */
const SERIES_START = "1999-01-04";

export type FxLookup = {
  jpyPerUsd: number;
  /** Units per 1 USD for every supported currency, for converting GBP/AUD. */
  rates: RateTable;
  /** The date the rate is actually from. */
  effectiveDate: Date;
  /** True when the requested date had no rate and a substitute was used. */
  isFallback: boolean;
  /**
   * How far the effective date is from the one asked for, in days. A weekend
   * roll-back is 1-3; anything large means the number is a poor stand-in and
   * the UI says so.
   */
  distanceDays: number;
};

export class FxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxUnavailableError";
  }
}

/** Normalizes to local noon so a date is one cache row regardless of time. */
function dayKey(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

type FetchOutcome =
  | { kind: "ok"; jpyPerUsd: number; gbpPerUsd: number | null; audPerUsd: number | null; effectiveDate: Date }
  /** The date is genuinely outside the published series. */
  | { kind: "notfound" }
  /** Network failure or upstream 5xx — says nothing about the date. */
  | { kind: "error" };

type FrankfurterResponse = {
  date?: string;
  rates?: { JPY?: number; GBP?: number; AUD?: number };
};

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function buildRates(
  jpyPerUsd: number,
  gbpPerUsd: number | null,
  audPerUsd: number | null,
): RateTable {
  const rates: RateTable = { USD: 1, JPY: jpyPerUsd };
  if (gbpPerUsd) rates.GBP = gbpPerUsd;
  if (audPerUsd) rates.AUD = audPerUsd;
  return rates;
}

async function fetchRateOnce(url: string): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { kind: "error" };
  }

  if (res.status === 404) return { kind: "notfound" };
  if (!res.ok) return { kind: "error" };

  const body = (await res.json().catch(() => null)) as FrankfurterResponse | null;
  const rate = positive(body?.rates?.JPY);
  if (rate === null) return { kind: "error" };

  const effective = body?.date ? new Date(`${body.date}T12:00:00`) : null;
  return {
    kind: "ok",
    jpyPerUsd: rate,
    gbpPerUsd: positive(body?.rates?.GBP),
    audPerUsd: positive(body?.rates?.AUD),
    effectiveDate:
      effective && !Number.isNaN(effective.getTime()) ? effective : new Date(),
  };
}

/** Retries once on a transient failure; a 404 is returned immediately. */
async function fetchRate(url: string): Promise<FetchOutcome> {
  const first = await fetchRateOnce(url);
  if (first.kind !== "error") return first;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return fetchRateOnce(url);
}

/**
 * The cached rate closest to the requested date, looking both directions.
 * Ordering by date descending would return the most *recent* rate, which for an
 * old transaction can be years away — the bug this exists to avoid.
 */
async function nearestCachedRate(requestedDate: Date) {
  const [before, after] = await Promise.all([
    prisma.fxRate.findFirst({
      where: { effectiveDate: { lte: requestedDate }, isFallback: false },
      orderBy: { effectiveDate: "desc" },
    }),
    prisma.fxRate.findFirst({
      where: { effectiveDate: { gte: requestedDate }, isFallback: false },
      orderBy: { effectiveDate: "asc" },
    }),
  ]);

  if (!before) return after;
  if (!after) return before;
  return daysBetween(before.effectiveDate, requestedDate) <=
    daysBetween(after.effectiveDate, requestedDate)
    ? before
    : after;
}

/**
 * The rate for a given date, from cache when possible.
 *
 * Never throws for an ordinary miss: a date outside the series clamps to the
 * nearest end of it, and an unreachable service falls back to the nearest
 * cached rate rather than blocking a save. It only throws when there is no
 * usable number at all.
 */
export async function getRateForDate(
  date: Date,
  /** Currency the caller needs a rate for; rows cached before GBP/AUD support
   *  hold only JPY, so asking for one of those forces a refetch. */
  needed: Currency = "JPY",
): Promise<FxLookup> {
  const requestedDate = dayKey(date);

  const cached = await prisma.fxRate.findUnique({ where: { requestedDate } });
  const cacheSatisfies =
    cached !== null &&
    (needed === "USD" ||
      needed === "JPY" ||
      (needed === "GBP" && cached.gbpPerUsd !== null) ||
      (needed === "AUD" && cached.audPerUsd !== null));

  if (cached && cacheSatisfies) {
    return {
      jpyPerUsd: cached.jpyPerUsd,
      rates: buildRates(cached.jpyPerUsd, cached.gbpPerUsd, cached.audPerUsd),
      effectiveDate: cached.effectiveDate,
      isFallback: cached.isFallback,
      distanceDays: daysBetween(cached.effectiveDate, requestedDate),
    };
  }

  const outcome = await fetchRate(
    `${BASE_URL}/${toDateInputValue(requestedDate)}?base=USD&symbols=${SYMBOLS}`,
  );

  if (outcome.kind === "ok") {
    const data = {
      effectiveDate: outcome.effectiveDate,
      jpyPerUsd: outcome.jpyPerUsd,
      gbpPerUsd: outcome.gbpPerUsd,
      audPerUsd: outcome.audPerUsd,
      isFallback: false,
    };
    // Genuine data for this date — worth caching permanently. An existing row
    // predating GBP/AUD support is updated rather than duplicated.
    await prisma.fxRate
      .upsert({ where: { requestedDate }, create: { requestedDate, ...data }, update: data })
      .catch(() => undefined);

    return {
      jpyPerUsd: outcome.jpyPerUsd,
      rates: buildRates(outcome.jpyPerUsd, outcome.gbpPerUsd, outcome.audPerUsd),
      effectiveDate: outcome.effectiveDate,
      isFallback: false,
      distanceDays: daysBetween(outcome.effectiveDate, requestedDate),
    };
  }

  if (outcome.kind === "notfound") {
    // Outside the series. Clamp to whichever end is actually nearer: the start
    // for a pre-1999 date, the latest publication for a future one. Using
    // "latest" unconditionally would price a 1998 purchase at today's rate.
    const isBeforeSeries = toDateInputValue(requestedDate) < SERIES_START;
    const edge = await fetchRate(
      isBeforeSeries
        ? `${BASE_URL}/${SERIES_START}?base=USD&symbols=JPY`
        : LATEST_URL,
    );

    if (edge.kind === "ok") {
      // Deliberately not cached: a future date will become real once published,
      // and caching the stand-in would freeze the wrong number in place.
      return {
        jpyPerUsd: edge.jpyPerUsd,
        rates: buildRates(edge.jpyPerUsd, edge.gbpPerUsd, edge.audPerUsd),
        effectiveDate: edge.effectiveDate,
        isFallback: true,
        distanceDays: daysBetween(edge.effectiveDate, requestedDate),
      };
    }
  }

  // Transient failure, or the edge lookup also failed. Use the nearest rate we
  // already hold — never today's, unless today's happens to be the nearest.
  const nearest = await nearestCachedRate(requestedDate);
  if (!nearest) {
    throw new FxUnavailableError(
      "Could not reach the exchange-rate service and no nearby rate has been " +
        "cached yet. Enter both the USD and JPY amounts manually, or try again " +
        "once you're online.",
    );
  }

  return {
    jpyPerUsd: nearest.jpyPerUsd,
    rates: buildRates(nearest.jpyPerUsd, nearest.gbpPerUsd, nearest.audPerUsd),
    effectiveDate: nearest.effectiveDate,
    isFallback: true,
    distanceDays: daysBetween(nearest.effectiveDate, requestedDate),
  };
}
