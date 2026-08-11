"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addManualComp, type ActionState } from "@/lib/actions";
import { GRADER_LABELS, GRADERS } from "@/lib/labels";
import { Field, FormError } from "@/components/ui";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Adding…" : "Add comp"}
    </button>
  );
}

/** Records a sold comp you found yourself, at the price it truly closed at. */
export function ManualCompForm({ searchId }: { searchId: string }) {
  const [state, formAction] = useFormState(addManualComp, {} as ActionState);
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
      <input type="hidden" name="searchId" value={searchId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Listing title">
          <input name="title" required placeholder="PSA 10 Charizard Base Set" className="input" />
        </Field>
        <Field label="Sale price" hint="What it actually sold for.">
          <input name="salePrice" inputMode="decimal" required placeholder="0.00" className="input" />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Field label="Sold date">
          <input name="soldAt" type="date" className="input" />
        </Field>
        <Field label="Grader">
          <select name="grader" defaultValue="" className="input">
            <option value="">—</option>
            {GRADERS.map((g) => (
              <option key={g} value={g}>
                {GRADER_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Grade">
          <input name="grade" placeholder="10" className="input" />
        </Field>
        <Field label="Listing URL">
          <input name="url" className="input" />
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
        This was an accepted Best Offer
      </label>

      {wasBestOffer ? (
        <Field label="Original asking price" hint="Optional, for reference.">
          <input name="listedPrice" inputMode="decimal" placeholder="0.00" className="input sm:max-w-xs" />
        </Field>
      ) : null}

      <SubmitButton />
    </form>
  );
}
