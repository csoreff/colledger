"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import type { Item, Purchase } from "@prisma/client";
import type { ActionState } from "@/lib/actions";
import { ITEM_TYPE_LABELS, ITEM_TYPES } from "@/lib/labels";
import { Field, FormError } from "@/components/ui";
import { PurchaseRows } from "@/components/PurchaseRows";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : label}
    </button>
  );
}

/**
 * Identity of the card or volume, plus its purchase rows. The identity is what
 * the thing *is*; each purchase row is a copy you actually own, with its own
 * money, condition and status.
 */
export function ItemForm({
  action,
  item,
  purchases,
  submitLabel,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  item?: Item;
  purchases?: Purchase[];
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {} as ActionState);
  const [type, setType] = useState(item?.type ?? "CARD");

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
        </div>
      </section>

      <PurchaseRows purchases={purchases} itemType={type} />

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
            placeholder={
              type === "MANGA" ? "Chainsaw Man vol 1 first print" : "Charizard base set holo"
            }
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

/** Standalone "add another copy" form used on the item page. */
export function AddPurchaseForm({
  action,
  itemType,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  itemType: string;
}) {
  const [state, formAction] = useFormState(action, {} as ActionState);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      <PurchaseRows
        itemType={itemType}
        heading="Add a purchase"
        description="Another copy of this same card, with its own price, date and condition."
      />
      <SubmitButton label="Add purchase" />
    </form>
  );
}
