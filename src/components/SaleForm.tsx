"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createSale, type ActionState } from "@/lib/actions";
import { todayInputValue } from "@/lib/dates";
import { MARKETPLACE_LABELS, MARKETPLACES } from "@/lib/labels";
import { Field, FormError } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Recording…" : "Record sale"}
    </button>
  );
}

export function SaleForm({ itemId }: { itemId: string }) {
  const [state, formAction] = useFormState(createSale, {} as ActionState);
  const [wasBestOffer, setWasBestOffer] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setWasBestOffer(false);
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <input type="hidden" name="itemId" value={itemId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="Sale price"
          hint={wasBestOffer ? "The offer you actually accepted." : "What the buyer paid for the item."}
        >
          <input
            name="grossPrice"
            inputMode="decimal"
            required
            placeholder="0.00"
            className="input"
          />
        </Field>

        <Field label="Sale date">
          <input
            name="soldAt"
            type="date"
            required
            defaultValue={todayInputValue()}
            className="input"
          />
        </Field>

        <Field label="Sold on">
          <select name="platform" defaultValue="EBAY" className="input">
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {MARKETPLACE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          name="wasBestOffer"
          checked={wasBestOffer}
          onChange={(e) => setWasBestOffer(e.target.checked)}
          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
        />
        Sold via accepted Best Offer
      </label>

      {wasBestOffer ? (
        <Field
          label="Original asking price"
          hint="Kept for reference. Profit is always calculated from the accepted offer above."
        >
          <input
            name="listedPrice"
            inputMode="decimal"
            placeholder="0.00"
            className="input sm:max-w-xs"
          />
        </Field>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Shipping collected" hint="Charged to buyer">
          <input name="shippingCollected" inputMode="decimal" placeholder="0.00" className="input" />
        </Field>
        <Field label="Platform fees" hint="Marketplace + payment">
          <input name="platformFee" inputMode="decimal" placeholder="0.00" className="input" />
        </Field>
        <Field label="Shipping cost" hint="Postage you paid">
          <input name="shippingCost" inputMode="decimal" placeholder="0.00" className="input" />
        </Field>
        <Field label="Other fees">
          <input name="otherFee" inputMode="decimal" placeholder="0.00" className="input" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Quantity">
          <input name="quantity" type="number" min={1} defaultValue={1} className="input" />
        </Field>
        <Field label="Buyer">
          <input name="buyer" className="input" />
        </Field>
        <Field label="Notes">
          <input name="notes" className="input" />
        </Field>
      </div>

      <SubmitButton />
    </form>
  );
}
