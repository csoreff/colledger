"use client";

import { useEffect, useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { registerUser } from "@/lib/auth-actions";
import type { ActionState } from "@/lib/actions";
import { Field, FormError } from "@/components/ui";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Sign-in.
 *
 * `signIn` is called with `redirect: false` so a bad password re-renders this
 * form with a message instead of bouncing through NextAuth's own error page and
 * losing what was typed.
 */
export function LoginForm({ signupOpen }: { signupOpen: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Middleware appends the page that was being asked for; come back to it
  // after signing in rather than always dumping the user on the dashboard.
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const justRegistered = searchParams.get("registered") === "1";

  async function onSubmit(form: FormData) {
    setError(null);
    const result = await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirect: false,
    });

    if (!result || result.error) {
      setError("That email and password don't match an account.");
      return;
    }
    startTransition(() => {
      router.push(callbackUrl);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="card space-y-4">
      {justRegistered ? (
        <p className="rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Account created. Sign in to get started.
        </p>
      ) : null}

      <FormError message={error ?? undefined} />

      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required className="input" />
      </Field>
      <Field label="Password">
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </Field>

      <SubmitButton label={pending ? "Signing in…" : "Sign in"} pendingLabel="Checking…" />

      {signupOpen ? (
        <p className="text-center text-sm text-slate-500">
          No account?{" "}
          <Link href="/register" className="text-emerald-400 hover:underline">
            Create one
          </Link>
        </p>
      ) : null}
    </form>
  );
}

/**
 * Registration. The account is created by a server action; signing in is a
 * separate client call, so on success we hand off to the login page rather than
 * trying to do both at once.
 */
export function RegisterForm() {
  const router = useRouter();
  const [state, formAction] = useFormState(registerUser, {} as ActionState);

  // The action can't redirect for us — it has to return a result so a duplicate
  // email can be shown in the form — so the hand-off happens here once it
  // reports success.
  useEffect(() => {
    if (state.ok) router.push("/login?registered=1");
  }, [state.ok, router]);

  return (
    <form action={formAction} className="card space-y-4">
      <FormError message={state.error} />

      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required className="input" />
      </Field>
      <Field label="Name" hint="Optional.">
        <input name="name" autoComplete="name" className="input" />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="input"
        />
      </Field>
      <Field label="Confirm password">
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="input"
        />
      </Field>

      <SubmitButton label="Create account" pendingLabel="Creating…" />

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="text-emerald-400 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
      title="Sign out"
    >
      <LogOut className="h-4 w-4" />
      <span className="sr-only sm:not-sr-only">Sign out</span>
    </button>
  );
}
