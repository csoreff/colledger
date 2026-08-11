// Server-side only: it reads the FxRate cache through Prisma, which cannot run
// in the browser. Deliberately not guarded with the `server-only` package —
// that throws outside Next's bundler and would make this untestable in a script.
import { prisma } from "@/lib/prisma";
import { toDateInputValue } from "@/lib/dates";

/**
 * Historical USD->JPY rates, from the ECB series via frankfurter.dev (free, no
 * key). Rates are cached per requested date, so each transaction date is only
 * ever fetched once.
 *
 * Two things about the upstream data shape the handling here:
 *  - There are no weekend or holiday rates. Asking for a Sunday returns the
 *    previous business day, and we record which date the number came from.
 *  - The series starts in 1999 and stops at the last published business day,
 *    so future dates and very old dates 404. Those fall back to the latest
 *    rate available and are flagged.
 */

const BASE_URL = "https://api.frankfurter.dev/v1";
const LATEST_URL = `${BASE_URL}/latest?base=USD&symbols=JPY`;

export type FxLookup = {
  jpyPerUsd: number;
  /** The date the rate is actually from. */
  effectiveDate: Date;
  /** True when the requested date had no rate and a substitute was used. */
  isFallback: boolean;
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

type FrankfurterResponse = { date?: string; rates?: { JPY?: number } };

async function fetchRate(url: string): Promise<FxLookup | null> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as FrankfurterResponse | null;
  const rate = body?.rates?.JPY;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;

  const effective = body?.date ? new Date(`${body.date}T12:00:00`) : null;
  return {
    jpyPerUsd: rate,
    effectiveDate: effective && !Number.isNaN(effective.getTime()) ? effective : new Date(),
    isFallback: false,
  };
}

/**
 * The rate for a given date, from cache when possible.
 *
 * Never throws for an ordinary miss: if the network is down but we've cached
 * any rate before, the nearest one is used rather than blocking a save. It only
 * throws when there is no usable number at all.
 */
export async function getRateForDate(date: Date): Promise<FxLookup> {
  const requestedDate = dayKey(date);

  const cached = await prisma.fxRate.findUnique({ where: { requestedDate } });
  if (cached) {
    return {
      jpyPerUsd: cached.jpyPerUsd,
      effectiveDate: cached.effectiveDate,
      isFallback: cached.isFallback,
    };
  }

  let result: FxLookup | null = null;
  let isFallback = false;

  try {
    result = await fetchRate(`${BASE_URL}/${toDateInputValue(requestedDate)}?base=USD&symbols=JPY`);
    if (!result) {
      // Outside the published series (a future date, or pre-1999).
      result = await fetchRate(LATEST_URL);
      isFallback = result !== null;
    }
  } catch {
    result = null;
  }

  if (!result) {
    // Offline, or upstream is down. Fall back to the closest rate we hold.
    const nearest = await prisma.fxRate.findFirst({
      orderBy: { effectiveDate: "desc" },
    });
    if (!nearest) {
      throw new FxUnavailableError(
        "Could not reach the exchange-rate service and no rate has been cached yet. " +
          "Enter both the USD and JPY amounts manually, or try again once you're online.",
      );
    }
    return {
      jpyPerUsd: nearest.jpyPerUsd,
      effectiveDate: nearest.effectiveDate,
      isFallback: true,
    };
  }

  const stored = { ...result, isFallback };

  // Concurrent saves can race on the same date; the unique key settles it.
  await prisma.fxRate
    .create({
      data: {
        requestedDate,
        effectiveDate: stored.effectiveDate,
        jpyPerUsd: stored.jpyPerUsd,
        isFallback: stored.isFallback,
      },
    })
    .catch(() => undefined);

  return stored;
}
