"use client";

import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

function Inner({
  label,
  pendingLabel,
  iconOnly,
}: {
  label: string;
  pendingLabel: string;
  iconOnly: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={iconOnly ? "text-slate-500 hover:text-rose-400 disabled:opacity-50" : "btn-danger"}
      aria-label={label}
      title={label}
    >
      {iconOnly ? <Trash2 className="h-4 w-4" /> : pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Wraps a server action in a form with a confirmation prompt. Deletes cascade
 * (an item takes its expenses and sales with it), so confirm before firing.
 */
export function DeleteButton({
  action,
  label = "Delete",
  // Not every destructive action is a delete — revoking a key uses this too —
  // so the in-flight wording follows the label rather than always saying
  // "Deleting…".
  pendingLabel = "Deleting…",
  confirmMessage = "Delete this? This cannot be undone.",
  iconOnly = false,
}: {
  action: () => Promise<void>;
  label?: string;
  pendingLabel?: string;
  confirmMessage?: string;
  iconOnly?: boolean;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <Inner label={label} pendingLabel={pendingLabel} iconOnly={iconOnly} />
    </form>
  );
}
