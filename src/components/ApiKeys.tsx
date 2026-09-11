"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Check, Copy, KeyRound } from "lucide-react";
import type { ApiScope, UserRole } from "@prisma/client";
import {
  changePassword,
  createApiKey,
  deleteApiKey,
  revokeApiKey,
  type KeyCreatedState,
} from "@/lib/settings-actions";
import type { ActionState } from "@/lib/actions";
import { formatDate } from "@/lib/dates";
import { Chip, Field, FormError } from "@/components/ui";
import { DeleteButton } from "@/components/DeleteButton";

const SCOPE_COPY: Record<ApiScope, { label: string; hint: string }> = {
  READ: { label: "Read", hint: "List and fetch the ledger." },
  WRITE: { label: "Write", hint: "Create, update and delete rows. Implies read." },
  ADMIN_ALL: {
    label: "Admin",
    hint: "Act on any account by naming it, and manage users. Admins only.",
  },
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * The one and only time the plaintext key is visible.
 *
 * Deliberately loud about that: the server kept only a hash, so there is no
 * "show it again" to fall back on, and someone who closes this without copying
 * has to mint a replacement.
 */
function NewKeyBanner({ plaintext, name }: { plaintext: string; name?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-4 rounded-lg border border-emerald-800/70 bg-emerald-950/30 p-4">
      <p className="text-sm font-medium text-emerald-300">
        Key created{name ? `: ${name}` : ""} — copy it now
      </p>
      <p className="mt-1 text-xs text-slate-400">
        This is the only time it will be shown. Only a hash is stored, so it cannot be
        recovered later.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-200">
          {plaintext}
        </code>
        <button
          type="button"
          className="btn-secondary shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(plaintext);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function ApiKeyManager({ keys, role }: { keys: KeyRow[]; role: UserRole }) {
  const [state, formAction] = useFormState(createApiKey, {} as KeyCreatedState);

  return (
    <>
      <section className="card mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Create an API key
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          For pushing data in from a script, or querying the ledger from elsewhere.
        </p>

        {state.plaintext ? (
          <NewKeyBanner plaintext={state.plaintext} name={state.name} />
        ) : null}

        <form action={formAction} className="space-y-4">
          <FormError message={state.error} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" hint="Something you'll recognize, e.g. “import script”.">
              <input name="name" required className="input" placeholder="import script" />
            </Field>
            <Field label="Expires in (days)" hint="Leave blank for a key that never expires.">
              <input
                name="expiresInDays"
                type="number"
                min={1}
                className="input"
                placeholder="90"
              />
            </Field>
          </div>

          <div>
            <span className="label">Scopes</span>
            <div className="mt-1 space-y-2">
              {(Object.keys(SCOPE_COPY) as ApiScope[]).map((scope) => {
                const adminOnly = scope === "ADMIN_ALL" && role !== "ADMIN";
                return (
                  <label
                    key={scope}
                    className={`flex items-start gap-3 rounded-lg border border-slate-800 px-3 py-2 ${
                      adminOnly ? "opacity-50" : "hover:border-slate-700"
                    }`}
                  >
                    <input
                      type="checkbox"
                      name="scopes"
                      value={scope}
                      defaultChecked={scope === "READ"}
                      disabled={adminOnly}
                      className="mt-1"
                    />
                    <span>
                      <span className="text-sm font-medium text-slate-200">
                        {SCOPE_COPY[scope].label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {SCOPE_COPY[scope].hint}
                        {adminOnly ? " Your account is not an admin." : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <SubmitButton label="Create key" pendingLabel="Creating…" />
        </form>
      </section>

      <section className="card mb-6 p-0">
        <h2 className="border-b border-slate-800 px-6 py-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Your keys
        </h2>

        {keys.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-500">No API keys yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Key</th>
                  <th className="th">Scopes</th>
                  <th className="th">Last used</th>
                  <th className="th">Status</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {keys.map((key) => {
                  const expired =
                    key.expiresAt !== null && key.expiresAt.getTime() <= Date.now();
                  return (
                    <tr key={key.id} className="hover:bg-slate-800/30">
                      <td className="td font-medium">
                        <span className="flex items-center gap-2">
                          <KeyRound className="h-3.5 w-3.5 text-slate-500" />
                          {key.name}
                        </span>
                        <span className="text-xs text-slate-500">
                          created {formatDate(key.createdAt)}
                        </span>
                      </td>
                      <td className="td font-mono text-xs text-slate-400">{key.prefix}…</td>
                      <td className="td">
                        <span className="flex flex-wrap gap-1">
                          {key.scopes.map((scope) => (
                            <Chip key={scope} tone={scope === "ADMIN_ALL" ? "amber" : "slate"}>
                              {SCOPE_COPY[scope].label}
                            </Chip>
                          ))}
                        </span>
                      </td>
                      <td className="td text-slate-400">
                        {key.lastUsedAt ? formatDate(key.lastUsedAt) : "never"}
                      </td>
                      <td className="td">
                        {key.revokedAt ? (
                          <Chip tone="rose">Revoked</Chip>
                        ) : expired ? (
                          <Chip tone="rose">Expired</Chip>
                        ) : key.expiresAt ? (
                          <Chip tone="emerald">
                            until {formatDate(key.expiresAt)}
                          </Chip>
                        ) : (
                          <Chip tone="emerald">Active</Chip>
                        )}
                      </td>
                      <td className="td text-right">
                        {key.revokedAt ? (
                          <DeleteButton
                            action={deleteApiKey.bind(null, key.id)}
                            label="Remove"
                            confirmMessage={`Remove the revoked key "${key.name}" from this list?`}
                          />
                        ) : (
                          <DeleteButton
                            action={revokeApiKey.bind(null, key.id)}
                            label="Revoke"
                            pendingLabel="Revoking…"
                            confirmMessage={`Revoke "${key.name}"? Anything using it stops working immediately.`}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useFormState(changePassword, {} as ActionState);

  return (
    <form action={formAction} className="space-y-4">
      <FormError message={state.error} />
      {state.ok ? (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Password updated.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current password">
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className="input"
          />
        </Field>
        <Field label="New password">
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            className="input"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            className="input"
          />
        </Field>
      </div>

      <SubmitButton label="Change password" pendingLabel="Saving…" />
    </form>
  );
}
