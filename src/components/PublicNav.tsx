"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";

/**
 * The header an anonymous visitor sees — currently only on a public showcase,
 * the one page reachable without signing in.
 *
 * A client component purely so it can read the pathname: the root layout
 * renders it outside `<main>` to get the same full-width bar as the signed-in
 * nav, and a server layout there cannot tell which route is being served.
 *
 * The wordmark is deliberately not a link. Anonymous visitors have nowhere to
 * go but the sign-in page, and a logo that navigates to a login form is a
 * small trap; the explicit button is the only action offered.
 */
export function PublicNav() {
  const pathname = usePathname();

  // Sign-in and registration already show the wordmark and are themselves the
  // destination, so a bar pointing at them would be circular.
  if (pathname === "/login" || pathname === "/register") return null;

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <span className="text-lg font-semibold tracking-tight">
          <span className="text-emerald-400">Col</span>ledger
        </span>

        <Link
          href="/login"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <LogIn className="h-4 w-4" />
          Sign in
        </Link>
      </div>
    </header>
  );
}
