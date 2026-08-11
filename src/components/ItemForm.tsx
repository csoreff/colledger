"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { Item } from "@prisma/client";
import type { ActionState } from "@/lib/actions";
import { CURRENCIES, CURRENCY_LABELS, toInputValue } from "@/lib/currency";
import { todayInputValue, toDateInputValue } from "@/lib/dates";
import {
  gradeOptionsFor,
  GRADER_LABELS,
  GRADERS,
  maxGradeLabel,
  ITEM_STATUS_LABELS,
  ITEM_STATUSES,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  MARKETPLACE_LABELS,
  MARKETPLACES,
  defaultCurrencyFor,
} from "@/lib/labels";
import { Field, FormError } from "@/components/ui";
import { FxRateNotice, FxRateProvider, MoneyInput } from "@/components/MoneyInput";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

export function ItemForm({
  action,
  item,
  submitLabel,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  item?: Item;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {} as ActionState);
  const [grader, setGrader] = useState(item?.grader ?? "RAW");
  const [type, setType] = useState(item?.type ?? "CARD");
  const [source, setSource] = useState(item?.purchaseSource ?? "EBAY");
  const [currency, setCurrency] = useState(
    item?.purchaseCurrency ?? defaultCurrencyFor(item?.purchaseSource ?? "EBAY"),
  );
  const [acquiredAt, setAcquiredAt] = useState(
    item ? toDateInputValue(item.acquiredAt) : todayInputValue(),
  );

  const isGraded = grader !== "RAW";
  const maxGrade = maxGradeLabel(grader);
  const gradeOptions = gradeOptionsFor(grader);

  return (
    <form action={formAction} className="space-y-6">
      <FormError message={state.error} />

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          What it is
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type">
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="input"
            >
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Title">
            <input
              name="title"
              defaultValue={item?.title ?? ""}
              required
              placeholder={type === "MANGA" ? "Chainsaw Man Vol. 1" : "Charizard"}
              className="input"
            />
          </Field>

          <Field label={type === "MANGA" ? "Series" : "Set"}>
            <input
              name="setName"
              defaultValue={item?.setName ?? ""}
              placeholder={type === "MANGA" ? "Chainsaw Man" : "Base Set"}
              className="input"
            />
          </Field>

          <Field label={type === "MANGA" ? "Volume" : "Card number"}>
            <input
              name="number"
              defaultValue={item?.number ?? ""}
              placeholder={type === "MANGA" ? "1" : "4/102"}
              className="input"
            />
          </Field>

          <Field label="Variant / printing">
            <input
              name="variant"
              defaultValue={item?.variant ?? ""}
              placeholder={type === "MANGA" ? "1st print" : "1st Edition Holo"}
              className="input"
            />
          </Field>

          <Field label="Language">
            <input
              name="language"
              defaultValue={item?.language ?? "English"}
              className="input"
            />
          </Field>

          <Field label="Quantity">
            <input
              name="quantity"
              type="number"
              min={1}
              defaultValue={item?.quantity ?? 1}
              className="input"
            />
          </Field>

          <Field label="Status">
            <select name="status" defaultValue={item?.status ?? "OWNED"} className="input">
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ITEM_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Condition
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Graded by">
            <select
              name="grader"
              value={grader}
              onChange={(e) => setGrader(e.target.value as typeof grader)}
              className="input"
            >
              {GRADERS.map((g) => (
                <option key={g} value={g}>
                  {GRADER_LABELS[g]}
                </option>
              ))}
            </select>
          </Field>

          {isGraded ? (
            <>
              <Field
                label="Grade"
                hint={
                  maxGrade ? `Scale runs up to ${maxGrade}.` : undefined
                }
              >
                <input
                  name="grade"
                  defaultValue={item?.grade ?? ""}
                  placeholder={maxGrade ?? "10"}
                  className="input"
                  list="grade-options"
                />
                <datalist id="grade-options">
                  {gradeOptions.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
              <Field label="Cert number">
                <input
                  name="certNumber"
                  defaultValue={item?.certNumber ?? ""}
                  className="input"
                />
              </Field>
            </>
          ) : (
            <Field label="Raw condition" hint="e.g. NM, LP, Like New">
              <input
                name="condition"
                defaultValue={item?.condition ?? ""}
                placeholder={type === "MANGA" ? "Like New" : "NM"}
                className="input"
              />
            </Field>
          )}
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          What you paid
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Bought from">
            <select
              name="purchaseSource"
              value={source}
              onChange={(e) => {
                const next = e.target.value as typeof source;
                setSource(next);
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

          <Field label="Purchase date">
            <input
              name="acquiredAt"
              type="date"
              required
              value={acquiredAt}
              onChange={(e) => setAcquiredAt(e.target.value)}
              className="input"
            />
          </Field>

          <Field label="Paid in" hint="Which currency the money actually moved in.">
            <select
              name="purchaseCurrency"
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

        <FxRateProvider date={acquiredAt}>
          <MoneyInput
            name="purchase"
            label="Purchase price"
            required
            currency={currency}
            defaultUsd={toInputValue(
              item ? { usdCents: item.purchaseUsdCents, jpyYen: item.purchaseJpyYen } : null,
              "USD",
            )}
            defaultJpy={toInputValue(
              item ? { usdCents: item.purchaseUsdCents, jpyYen: item.purchaseJpyYen } : null,
              "JPY",
            )}
          />
          <FxRateNotice date={acquiredAt} />
        </FxRateProvider>

        <Field label="Purchase notes">
          <input name="purchaseNotes" defaultValue={item?.purchaseNotes ?? ""} className="input" />
        </Field>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Extras
        </h2>

        <Field
          label="Saved comp search"
          hint="Prefills the sold-comps lookup from this item's page."
        >
          <input
            name="compQuery"
            defaultValue={item?.compQuery ?? ""}
            placeholder={type === "MANGA" ? "Chainsaw Man vol 1 first print" : "Charizard base set holo"}
            className="input"
          />
        </Field>

        <Field label="Image URL">
          <input name="imageUrl" defaultValue={item?.imageUrl ?? ""} className="input" />
        </Field>

        <Field label="Notes">
          <textarea name="notes" defaultValue={item?.notes ?? ""} rows={3} className="input" />
        </Field>
      </section>

      <div className="flex gap-3">
        <SubmitButton label={submitLabel} />
        <Link href={item ? `/items/${item.id}` : "/items"} className="btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
