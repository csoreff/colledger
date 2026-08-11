"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { Marketplace } from "@prisma/client";
import { createSale, type ActionState } from "@/lib/actions";
import { todayInputValue } from "@/lib/dates";
import { CURRENCIES, CURRENCY_LABELS } from "@/lib/currency";
import { defaultCurrencyFor, MARKETPLACE_LABELS, MARKETPLACES } from "@/lib/labels";
import { Field, FormError } from "@/components/ui";
import { FxRateNotice, FxRateProvider, MoneyInput } from "@/components/MoneyInput";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Recording…" : "Record sale"}
    </button>
  );
}

export function SaleForm({ purchaseId }: { purchaseId: string }) {
  const [state, formAction] = useFormState(createSale, {} as ActionState);
  const [wasBestOffer, setWasBestOffer] = useState(false);
  const [soldAt, setSoldAt] = useState(todayInputValue());
  const [platform, setPlatform] = useState<Marketplace>("EBAY");
  const [currency, setCurrency] = useState(defaultCurrencyFor("EBAY"));
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setWasBestOffer(false);
      setSoldAt(todayInputValue());
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <input type="hidden" name="purchaseId" value={purchaseId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Sale date">
          <input
            name="soldAt"
            type="date"
            required
            value={soldAt}
            onChange={(e) => setSoldAt(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Sold on">
          <select
            name="platform"
            value={platform}
            onChange={(e) => {
              const next = e.target.value as Marketplace;
              setPlatform(next);
              setCurrency(defaultCurrencyFor(next));
            }}
            className="input"
          >
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {MARKETPLACE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Settled in" hint="Which currency you were actually paid in.">
          <select
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as typeof currency)}
            className="input"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <FxRateProvider date={soldAt}>
        <MoneyInput
          name="grossPrice"
          label="Sale price"
          required
          currency={currency}
          hint={
            wasBestOffer
              ? "The offer you actually accepted."
              : "What the buyer paid for the item."
          }
        />

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
          <MoneyInput
            name="listedPrice"
            label="Original asking price"
            currency={currency}
            hint="Kept for reference. Profit is always calculated from the accepted offer above."
          />
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MoneyInput
            name="shippingCollected"
            label="Shipping collected"
            currency={currency}
            hint="Charged to buyer"
          />
          <MoneyInput
            name="platformFee"
            label="Platform fees"
            currency={currency}
            hint="Marketplace + payment"
          />
          <MoneyInput
            name="shippingCost"
            label="Shipping cost"
            currency={currency}
            hint="Postage you paid"
          />
          <MoneyInput name="otherFee" label="Other fees" currency={currency} />
        </div>

        <FxRateNotice date={soldAt} />
      </FxRateProvider>

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
