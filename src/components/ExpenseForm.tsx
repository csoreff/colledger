"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import type { Currency, Expense } from "@prisma/client";
import { createExpense, updateExpense, type ActionState } from "@/lib/actions";
import { todayInputValue, toDateInputValue } from "@/lib/dates";
import {
  CURRENCY_LABELS,
  REPORTING_CURRENCIES,
  toInputValue,
} from "@/lib/currency";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { Field, FormError } from "@/components/ui";
import { FxRateNotice, FxRateProvider, MoneyInput } from "@/components/MoneyInput";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Adds or edits an expense.
 *
 * Pass `purchaseId` to attach a new expense to one purchased copy; omit it for
 * a general expense. Pass `expense` to edit an existing one — which purchase it
 * belongs to is not editable here, so that association is left untouched.
 *
 * Only USD and JPY are offered: they are the reporting pair, and unlike a
 * purchase an expense has nowhere to record a native GBP/AUD figure, so
 * offering those would silently discard what was actually paid.
 */
export function ExpenseForm({
  purchaseId,
  expense,
  defaultCategory = "OTHER",
  onSaved,
  onCancel,
}: {
  purchaseId?: string;
  expense?: Expense;
  defaultCategory?: (typeof EXPENSE_CATEGORIES)[number];
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = expense !== undefined;
  const action = isEdit ? updateExpense.bind(null, expense.id) : createExpense;
  const [state, formAction] = useFormState(action, {} as ActionState);

  const [incurredAt, setIncurredAt] = useState(
    expense ? toDateInputValue(expense.incurredAt) : todayInputValue(),
  );
  const [currency, setCurrency] = useState<Currency>(
    // An expense saved before the currency list was corrected could hold GBP or
    // AUD; fall back rather than showing a value the select cannot represent.
    expense && REPORTING_CURRENCIES.includes(expense.currency) ? expense.currency : "USD",
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    if (isEdit) {
      onSaved?.();
    } else {
      // Clear the fields after a successful add so several can be entered in a row.
      formRef.current?.reset();
      setIncurredAt(todayInputValue());
    }
  }, [state, isEdit, onSaved]);

  const money = expense
    ? { usdCents: expense.amountUsdCents, jpyYen: expense.amountJpyYen }
    : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError message={state.error} />
      {purchaseId && !isEdit ? (
        <input type="hidden" name="purchaseId" value={purchaseId} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Category">
          <select
            name="category"
            defaultValue={expense?.category ?? defaultCategory}
            className="input"
          >
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
            defaultValue={expense?.description ?? ""}
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
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="input"
          >
            {REPORTING_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <FxRateProvider date={incurredAt} currency={currency}>
        <MoneyInput
          name="amount"
          label="Amount"
          required
          currency={currency}
          defaultUsd={toInputValue(money, "USD")}
          defaultJpy={toInputValue(money, "JPY")}
        />
        <FxRateNotice date={incurredAt} currency={currency} />
      </FxRateProvider>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vendor">
          <input
            name="vendor"
            defaultValue={expense?.vendor ?? ""}
            placeholder="PSA"
            className="input"
          />
        </Field>
        <Field label="Notes">
          <input name="notes" defaultValue={expense?.notes ?? ""} className="input" />
        </Field>
      </div>

      <div className="flex gap-2">
        <SubmitButton
          label={isEdit ? "Save changes" : "Add expense"}
          pendingLabel={isEdit ? "Saving…" : "Adding…"}
        />
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
