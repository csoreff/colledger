"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Check, Copy, ExternalLink, Eye, EyeOff } from "lucide-react";
import { updateShowcase, type ShowcaseState } from "@/lib/settings-actions";
import { Field, FormError } from "@/components/ui";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/**
 * Controls the one page that is readable without signing in.
 *
 * The current state is stated in plain words above the toggle rather than left
 * to be inferred from a checkbox, because the cost of misreading this control
 * is publishing your collection without meaning to.
 */
export function ShowcaseSettings({
  enabled,
  slug,
  origin,
}: {
  enabled: boolean;
  slug: string | null;
  origin: string;
}) {
  const [state, formAction] = useFormState(updateShowcase, {} as ShowcaseState);
  const [checked, setChecked] = useState(enabled);
  const [copied, setCopied] = useState(false);

  // After a save the server's answer is authoritative; before that, the live
  // checkbox is what the user is looking at.
  const live = state.ok ? (state.enabled ?? checked) : checked;
  const currentSlug = state.slug ?? slug;
  const url = currentSlug ? `${origin}/showcase/${currentSlug}` : null;

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Saved. Your collection is {live ? "now public." : "private again."}
        </p>
      ) : null}

      <div
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
          live
            ? "border-amber-900/60 bg-amber-950/20"
            : "border-slate-800 bg-slate-900/40"
        }`}
      >
        {live ? (
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        )}
        <div className="text-sm">
          <p className={live ? "font-medium text-amber-200" : "font-medium text-slate-300"}>
            {live ? "Anyone with the link can see your collection" : "Your collection is private"}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {live
              ? "Held cards only — what you paid, what you sold, your expenses and your notes are never shown."
              : "Nobody can see any of your data without signing in."}
          </p>
        </div>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          name="publicShowcase"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span className="text-sm text-slate-200">Publish my collection publicly</span>
      </label>

      <Field
        label="Public address"
        hint="Lowercase letters, numbers and hyphens. Leave blank to have one chosen for you."
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-slate-500">{origin}/showcase/</span>
          <input
            name="publicSlug"
            defaultValue={currentSlug ?? ""}
            placeholder="my-collection"
            pattern="[a-zA-Z0-9\-]*"
            className="input"
          />
        </div>
      </Field>

      {url && live ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-200">
            {url}
          </code>
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`/showcase/${currentSlug}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary shrink-0"
          >
            <ExternalLink className="h-4 w-4" />
            View
          </a>
        </div>
      ) : null}

      <SaveButton />
    </form>
  );
}
