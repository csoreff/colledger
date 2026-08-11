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
};

export const CURRENCIES: Currency[] = ["USD", "JPY"];

export function formatRate(jpyPerUsd: number | null | undefined): string {
  if (jpyPerUsd === null || jpyPerUsd === undefined) return "—";
  return `¥${jpyPerUsd.toFixed(2)} / $1`;
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}
