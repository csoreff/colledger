import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signupIsOpen } from "@/lib/auth";
import { getCurrentUser } from "@/lib/tenant";
import { LoginForm } from "@/components/AuthForms";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in: no reason to show a login form.
  if (await getCurrentUser()) redirect("/");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-center text-2xl font-semibold tracking-tight">
        <span className="text-emerald-400">Col</span>ledger
      </h1>
      <p className="mb-6 mt-1 text-center text-sm text-slate-400">
        Sign in to your ledger.
      </p>
      {/* useSearchParams needs a boundary for the statically-rendered shell. */}
      <Suspense fallback={<div className="card h-72" />}>
        <LoginForm signupOpen={signupIsOpen()} />
      </Suspense>
    </div>
  );
}
