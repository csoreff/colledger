import Link from "next/link";
import { redirect } from "next/navigation";
import { signupIsOpen } from "@/lib/auth";
import { getCurrentUser } from "@/lib/tenant";
import { RegisterForm } from "@/components/AuthForms";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-center text-2xl font-semibold tracking-tight">
        <span className="text-emerald-400">Col</span>ledger
      </h1>
      <p className="mb-6 mt-1 text-center text-sm text-slate-400">
        Create an account. Your collection, costs and profit stay yours alone.
      </p>

      {signupIsOpen() ? (
        <RegisterForm />
      ) : (
        <div className="card text-center text-sm text-slate-400">
          <p>Registration is closed on this instance.</p>
          <Link href="/login" className="mt-3 inline-block text-emerald-400 hover:underline">
            Sign in instead
          </Link>
        </div>
      )}
    </div>
  );
}
