"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateProfile } from "@/lib/settings-actions";
import type { ActionState } from "@/lib/actions";
import { Field, FormError } from "@/components/ui";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save name"}
    </button>
  );
}

/**
 * Edits the display name.
 *
 * The email is shown but not editable: it is the sign-in identifier and the
 * unique key on the account, so changing it is a different job with its own
 * confirmation requirements — not something to bury in a text box here.
 */
export function ProfileSettings({
  name,
  email,
  showcaseSlug,
}: {
  name: string | null;
  email: string;
  showcaseSlug: string | null;
}) {
  const [state, formAction] = useFormState(updateProfile, {} as ActionState);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Name updated.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Display name"
          hint={
            showcaseSlug
              ? "Shown in the top bar, and as the heading of your public collection."
              : "Shown in the top bar. Leave blank to show your email instead."
          }
        >
          <input
            name="name"
            defaultValue={name ?? ""}
            maxLength={60}
            placeholder="Your name"
            className="input"
            autoComplete="name"
          />
        </Field>

        <Field label="Email" hint="Used to sign in. Not changeable here.">
          <input value={email} readOnly disabled className="input opacity-60" />
        </Field>
      </div>

      <SaveButton />
    </form>
  );
}
