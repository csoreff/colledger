/**
 * All money in this app is stored and passed around as integer cents.
 * Convert at the edges only: parse on input, format on output.
 */

/** Parse a user-typed amount ("1,234.56", "$12", "12.5") into cents. */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input.replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Same as parseMoneyToCents but returns 0 rather than null for blank input. */
export function parseMoneyToCentsOrZero(input: string | number | null | undefined): number {
  return parseMoneyToCents(input) ?? 0;
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return usd.format(cents / 100);
}

/** Formats with an explicit sign, for profit/loss figures. */
export function formatCentsSigned(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const formatted = usd.format(Math.abs(cents) / 100);
  if (cents > 0) return `+${formatted}`;
  if (cents < 0) return `−${formatted}`;
  return formatted;
}

/** Cents -> a plain decimal string suitable for a number input's value. */
export function centsToInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}
