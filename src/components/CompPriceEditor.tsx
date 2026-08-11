"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { Currency } from "@prisma/client";
import { setCompManualPrice } from "@/lib/actions";
import { formatJpy, formatUsd, toInputValue, type Money } from "@/lib/currency";

/**
 * Inline editor for a comp's true price, in both currencies. Its reason to
 * exist: when a provider can't see the amount an accepted Best Offer closed at,
 * you fill in the real number and it counts toward the stats from then on.
 *
 * Leaving both boxes empty clears the correction and reverts to the provider's
 * figure.
 */
export function CompPriceEditor({
  compId,
  salePrice,
  manualPrice,
  priceIsConfirmed,
  currency,
}: {
  compId: string;
  salePrice: Money;
  manualPrice: Money | null;
  priceIsConfirmed: boolean;
  currency: Currency;
}) {
  const effective = manualPrice ?? salePrice;
  const [editing, setEditing] = useState(false);
  const [usd, setUsd] = useState(toInputValue(effective, "USD"));
  const [jpy, setJpy] = useState(toInputValue(effective, "JPY"));
  const [isPending, startTransition] = useTransition();

  const needsPrice = !priceIsConfirmed && manualPrice === null;

  function save() {
    startTransition(async () => {
      await setCompManualPrice(compId, usd, jpy);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <span className="flex items-center justify-end gap-1">
        <span className="flex flex-col gap-1">
          <input
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") setEditing(false);
            }}
            inputMode="decimal"
            autoFocus
            aria-label="True price in USD"
            placeholder="$"
            className="input w-28 px-2 py-1 text-right text-sm"
          />
          <input
            value={jpy}
            onChange={(e) => setJpy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); save(); }
              if (e.key === "Escape") setEditing(false);
            }}
            inputMode="numeric"
            aria-label="True price in JPY"
            placeholder="¥"
            className="input w-28 px-2 py-1 text-right text-sm"
          />
        </span>
        <span className="flex flex-col gap-1">
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
            aria-label="Save price"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-slate-500 hover:text-slate-300"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      </span>
    );
  }

  const lead = currency === "JPY" ? formatJpy(effective.jpyYen) : formatUsd(effective.usdCents);
  const secondary =
    currency === "JPY" ? formatUsd(effective.usdCents) : formatJpy(effective.jpyYen);

  return (
    <span className="flex items-center justify-end gap-1.5">
      <span className="flex flex-col items-end">
        <span
          className={`tabular-nums leading-tight ${needsPrice ? "text-slate-500 line-through" : "font-medium"}`}
          title={needsPrice ? "Asking price only — the accepted offer is hidden" : undefined}
        >
          {lead}
        </span>
        <span
          className={`text-xs tabular-nums leading-tight text-slate-500 ${needsPrice ? "line-through" : ""}`}
        >
          {secondary}
        </span>
        {manualPrice !== null ? (
          <span className="text-[10px] uppercase tracking-wide text-emerald-400">yours</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-slate-600 hover:text-slate-300"
        aria-label="Set true price"
        title="Set the true accepted price"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
