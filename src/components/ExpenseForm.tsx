"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createExpense, type ActionState } from "@/lib/actions";
import { todayInputValue } from "@/lib/dates";
import { CURRENCIES, CURRENCY_LABELS } from "@/lib/currency";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { Field, FormError } from "@/components/ui";
import { FxRateNotice, FxRateProvider, MoneyInput } from "@/components/MoneyInput";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Adding…" : "Add expense"}
    </button>
  );
}

/**
 * Adds an expense. Pass `itemId` to attach it to an item; omit it for a
 * general expense that isn't tied to any single card or volume.
 */
export function ExpenseForm({
  itemId,
  defaultCategory = "OTHER",
}: {
  itemId?: string;
  defaultCategory?: (typeof EXPENSE_CATEGORIES)[number];
}) {
  const [state, formAction] = useFormState(createExpense, {} as ActionState);
  const [incurredAt, setIncurredAt] = useState(todayInputValue());
  const [currency, setCurrency] = useState<"USD" | "JPY">("USD");
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the fields after a successful add so several can be entered in a row.
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setIncurredAt(todayInputValue());
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError message={state.error} />
      {itemId ? <input type="hidden" name="itemId" value={itemId} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Category">
          <select name="category" defaultValue={defaultCategory} className="input">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EXPENSE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Description">
          <input
            name="description"
            required
            placeholder="PSA bulk submission"
            className="input"
          />
        </Field>

        <Field label="Date">
          <input
            name="incurredAt"
            type="date"
            required
            value={incurredAt}
            onChange={(e) => setIncurredAt(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Paid in">
          <select
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as "USD" | "JPY")}
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

      <FxRateProvider date={incurredAt}>
        <MoneyInput name="amount" label="Amount" required currency={currency} />
        <FxRateNotice date={incurredAt} />
      </FxRateProvider>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vendor">
          <input name="vendor" placeholder="PSA" className="input" />
        </Field>
        <Field label="Notes">
          <input name="notes" className="input" />
        </Field>
      </div>

      <SubmitButton />
    </form>
  );
}
