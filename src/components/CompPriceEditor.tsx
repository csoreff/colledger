"use client";

import { useState, useTransition } from "react";
import { Check, Pencil } from "lucide-react";
import { setCompManualPrice } from "@/lib/actions";
import { centsToInputValue, formatCents } from "@/lib/money";

/**
 * Inline editor for a comp's true price. Its reason to exist: when a provider
 * can't see the amount an accepted Best Offer closed at, you can fill in the
 * real number and have it count toward the stats from then on.
 */
export function CompPriceEditor({
  compId,
  salePriceCents,
  manualPriceCents,
  priceIsConfirmed,
}: {
  compId: string;
  salePriceCents: number;
  manualPriceCents: number | null;
  priceIsConfirmed: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    centsToInputValue(manualPriceCents ?? salePriceCents),
  );
  const [isPending, startTransition] = useTransition();

  const effective = manualPriceCents ?? salePriceCents;
  const needsPrice = !priceIsConfirmed && manualPriceCents === null;

  function save() {
    startTransition(async () => {
      await setCompManualPrice(compId, value);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <span className="flex items-center justify-end gap-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          inputMode="decimal"
          autoFocus
          className="input w-24 px-2 py-1 text-right text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
          aria-label="Save price"
        >
          <Check className="h-4 w-4" />
        </button>
      </span>
    );
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <span
        className={`tabular-nums ${needsPrice ? "text-slate-500 line-through" : "font-medium"}`}
        title={needsPrice ? "Asking price only — the accepted offer is hidden" : undefined}
      >
        {formatCents(effective)}
      </span>
      {manualPriceCents !== null ? (
        <span className="text-[10px] uppercase tracking-wide text-emerald-400">yours</span>
      ) : null}
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
