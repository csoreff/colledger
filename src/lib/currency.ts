import type { Currency } from "@prisma/client";

/**
 * Every amount in the ledger is carried as a pair: USD in cents and JPY in
 * whole yen. Yen has no subunit, so it is never scaled by 100.
 *
 * Both sides are stored rather than converted on read, so a figure stays at
 * its historical value however rates move afterwards.
 */
export type Money = { usdCents: number; jpyYen: number };

export const ZERO_MONEY: Money = { usdCents: 0, jpyYen: 0 };

export function usdCentsToJpyYen(usdCents: number, jpyPerUsd: number): number {
  return Math.round((usdCents / 100) * jpyPerUsd);
}

export function jpyYenToUsdCents(jpyYen: number, jpyPerUsd: number): number {
  return Math.round((jpyYen / jpyPerUsd) * 100);
}

/**
 * Completes a money pair from whichever side was supplied.
 * When both are given they're taken as-is — a marketplace's own conversion
 * beats a mid-market rate, so an explicit figure is never overwritten.
 */
export function makeMoney(
  input: { usdCents?: number | null; jpyYen?: number | null },
  jpyPerUsd: number,
  primary: Currency,
): Money {
  const { usdCents, jpyYen } = input;

  if (usdCents !== null && usdCents !== undefined && jpyYen !== null && jpyYen !== undefined) {
    return { usdCents, jpyYen };
  }
  if (primary === "JPY" || (usdCents === null || usdCents === undefined)) {
    const yen = jpyYen ?? 0;
    return { usdCents: jpyYenToUsdCents(yen, jpyPerUsd), jpyYen: yen };
  }
  const cents = usdCents ?? 0;
  return { usdCents: cents, jpyYen: usdCentsToJpyYen(cents, jpyPerUsd) };
}

export function addMoney(a: Money, b: Money): Money {
  return { usdCents: a.usdCents + b.usdCents, jpyYen: a.jpyYen + b.jpyYen };
}

export function subtractMoney(a: Money, b: Money): Money {
  return { usdCents: a.usdCents - b.usdCents, jpyYen: a.jpyYen - b.jpyYen };
}

export function sumMoney(values: Money[]): Money {
  return values.reduce(addMoney, ZERO_MONEY);
}

export function negateMoney(a: Money): Money {
  return { usdCents: -a.usdCents, jpyYen: -a.jpyYen };
}

export function isZeroMoney(a: Money): boolean {
  return a.usdCents === 0 && a.jpyYen === 0;
}

// --- Parsing -------------------------------------------------------------

/** "$1,234.56" -> 123456 cents. */
export function parseUsdToCents(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** "¥196,800" -> 196800 yen. Fractional yen is rounded away; it doesn't exist. */
export function parseJpyToYen(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/[¥￥,\s]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value) : null;
}

// --- Formatting ----------------------------------------------------------

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const jpyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "JPY",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatUsd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return usdFormat.format(cents / 100);
}

export function formatJpy(yen: number | null | undefined): string {
  if (yen === null || yen === undefined) return "—";
  return jpyFormat.format(yen);
}

export function formatMoney(
  money: Money | null | undefined,
  currency: Currency,
): string {
  if (!money) return "—";
  return currency === "JPY" ? formatJpy(money.jpyYen) : formatUsd(money.usdCents);
}

function formatSigned(value: number, format: (v: number) => string): string {
  const formatted = format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

export function formatMoneySigned(
  money: Money | null | undefined,
  currency: Currency,
): string {
  if (!money) return "—";
  return currency === "JPY"
    ? formatSigned(money.jpyYen, formatJpy)
    : formatSigned(money.usdCents, formatUsd);
}

/** The value in `currency`, in that currency's minor unit. */
export function amountIn(money: Money, currency: Currency): number {
  return currency === "JPY" ? money.jpyYen : money.usdCents;
}

/** Minor-unit value -> a string for a number input. Yen has no decimals. */
export function toInputValue(
  money: Money | null | undefined,
  currency: Currency,
): string {
  if (!money) return "";
  return currency === "JPY" ? String(money.jpyYen) : (money.usdCents / 100).toFixed(2);
}

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "USD ($)",
  JPY: "JPY (¥)",
  GBP: "GBP (£)",
  AUD: "AUD (A$)",
};

export const CURRENCIES: Currency[] = ["USD", "JPY", "GBP", "AUD"];

/**
 * USD and JPY are the reporting pair — every amount is stored in both and all
 * totals are computed in both. GBP and AUD are transaction currencies: an
 * amount paid in one is recorded natively and converted into the pair.
 */
export const REPORTING_CURRENCIES: Currency[] = ["USD", "JPY"];

export function isReportingCurrency(currency: Currency): boolean {
  return currency === "USD" || currency === "JPY";
}

/** Digits after the decimal point. Yen has no subunit; the rest use 2. */
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  USD: 2,
  JPY: 0,
  GBP: 2,
  AUD: 2,
};

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  USD: "$",
  JPY: "¥",
  GBP: "£",
  AUD: "A$",
};

/** Smallest-unit multiplier: 100 for cents/pence, 1 for yen. */
export function minorUnits(currency: Currency): number {
  return CURRENCY_DECIMALS[currency] === 0 ? 1 : 100;
}

/**
 * An amount in the currency it was actually transacted in, held in that
 * currency's minor unit. Distinct from `Money`, which is always the USD/JPY
 * reporting pair.
 */
export type NativeAmount = { minor: number; currency: Currency };

/** Parses typed input into a currency's minor unit. */
export function parseToMinor(
  input: string | null | undefined,
  currency: Currency,
): number | null {
  if (input === null || input === undefined) return null;
  const cleaned = String(input)
    .replace(/[$¥￥£,\s]/gi, "")
    .replace(/^A(?=[\d.-])/i, "")
    .trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * minorUnits(currency));
}

const numberFormatters = new Map<Currency, Intl.NumberFormat>();

function numberFormatterFor(currency: Currency): Intl.NumberFormat {
  let cached = numberFormatters.get(currency);
  if (!cached) {
    const digits = CURRENCY_DECIMALS[currency];
    cached = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numberFormatters.set(currency, cached);
  }
  return cached;
}

/**
 * Formats a minor-unit amount in its own currency, e.g. "£42.50", "A$61.00".
 *
 * The symbol is prepended from CURRENCY_SYMBOLS rather than left to Intl:
 * in an en-US locale Intl renders AUD as plain "$", which is indistinguishable
 * from USD — a genuinely dangerous ambiguity in a ledger that shows both.
 */
export function formatMinor(
  minor: number | null | undefined,
  currency: Currency,
): string {
  if (minor === null || minor === undefined) return "—";
  const value = minor / minorUnits(currency);
  const body = numberFormatterFor(currency).format(Math.abs(value));
  return `${value < 0 ? "−" : ""}${CURRENCY_SYMBOLS[currency]}${body}`;
}

/** Minor-unit amount -> a plain string for a number input. */
export function minorToInputValue(
  minor: number | null | undefined,
  currency: Currency,
): string {
  if (minor === null || minor === undefined) return "";
  const digits = CURRENCY_DECIMALS[currency];
  return (minor / minorUnits(currency)).toFixed(digits);
}

/** Rates for one date, expressed as units of each currency per 1 USD. */
export type RateTable = Partial<Record<Currency, number>> & { USD: 1 };

/**
 * Converts a natively-denominated amount into the USD/JPY reporting pair.
 * Throws nothing: a missing rate yields null so the caller can ask for both
 * figures by hand rather than silently recording a wrong number.
 */
export function nativeToMoney(
  native: NativeAmount,
  rates: RateTable,
): Money | null {
  const perUsd = native.currency === "USD" ? 1 : rates[native.currency];
  const jpyPerUsd = rates.JPY;
  if (!perUsd || !jpyPerUsd) return null;

  const usd = native.minor / minorUnits(native.currency) / perUsd;
  return {
    usdCents: Math.round(usd * 100),
    jpyYen: Math.round(usd * jpyPerUsd),
  };
}

/** The reverse: the reporting pair expressed in a transaction currency. */
export function moneyToNative(
  money: Money,
  currency: Currency,
  rates: RateTable,
): number | null {
  if (currency === "USD") return money.usdCents;
  if (currency === "JPY") return money.jpyYen;
  const perUsd = rates[currency];
  if (!perUsd) return null;
  return Math.round((money.usdCents / 100) * perUsd * minorUnits(currency));
}

export function formatRate(jpyPerUsd: number | null | undefined): string {
  if (jpyPerUsd === null || jpyPerUsd === undefined) return "—";
  return `¥${jpyPerUsd.toFixed(2)} / $1`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}
