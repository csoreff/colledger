import type { Currency } from "@prisma/client";
import {
  formatJpy,
  formatUsd,
  type Money,
} from "@/lib/currency";

function signed(value: number, format: (v: number) => string): string {
  const text = format(Math.abs(value));
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

/**
 * Shows an amount in both currencies. The currency the transaction actually
 * settled in leads; the converted figure sits under it, muted, because it's
 * derived rather than authoritative.
 */
export function MoneyValue({
  money,
  primary = "USD",
  align = "right",
  className = "",
}: {
  money: Money | null | undefined;
  primary?: Currency;
  align?: "left" | "right";
  className?: string;
}) {
  if (!money) return <span className="text-slate-500">—</span>;

  const lead = primary === "JPY" ? formatJpy(money.jpyYen) : formatUsd(money.usdCents);
  const secondary = primary === "JPY" ? formatUsd(money.usdCents) : formatJpy(money.jpyYen);

  return (
    <span
      className={`flex flex-col ${align === "right" ? "items-end" : "items-start"} ${className}`}
    >
      <span className="tabular-nums leading-tight">{lead}</span>
      <span className="text-xs tabular-nums leading-tight text-slate-500">{secondary}</span>
    </span>
  );
}

/** Profit in both currencies, coloured by sign. */
export function MoneyProfit({
  money,
  primary = "USD",
  align = "right",
}: {
  money: Money | null | undefined;
  primary?: Currency;
  align?: "left" | "right";
}) {
  if (!money) return <span className="text-slate-500">—</span>;

  const leadValue = primary === "JPY" ? money.jpyYen : money.usdCents;
  const lead =
    primary === "JPY" ? signed(money.jpyYen, formatJpy) : signed(money.usdCents, formatUsd);
  const secondary =
    primary === "JPY" ? signed(money.usdCents, formatUsd) : signed(money.jpyYen, formatJpy);

  const tone =
    leadValue > 0 ? "text-emerald-400" : leadValue < 0 ? "text-rose-400" : "text-slate-300";

  return (
    <span className={`flex flex-col ${align === "right" ? "items-end" : "items-start"}`}>
      <span className={`font-medium tabular-nums leading-tight ${tone}`}>{lead}</span>
      <span className={`text-xs tabular-nums leading-tight opacity-70 ${tone}`}>
        {secondary}
      </span>
    </span>
  );
}

/** Compact single-line variant, e.g. "$450.00 · ¥69,300". */
export function MoneyInline({
  money,
  primary = "USD",
}: {
  money: Money | null | undefined;
  primary?: Currency;
}) {
  if (!money) return <span className="text-slate-500">—</span>;
  const lead = primary === "JPY" ? formatJpy(money.jpyYen) : formatUsd(money.usdCents);
  const secondary = primary === "JPY" ? formatUsd(money.usdCents) : formatJpy(money.jpyYen);
  return (
    <span className="tabular-nums">
      {lead} <span className="text-slate-500">· {secondary}</span>
    </span>
  );
}
