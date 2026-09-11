"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, LayoutDashboard, Receipt, Search, Settings } from "lucide-react";
import type { CurrentUser } from "@/lib/tenant";
import { SignOutButton } from "@/components/AuthForms";

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/items", label: "Collection", icon: BookOpen, exact: false },
  { href: "/expenses", label: "Expenses", icon: Receipt, exact: false },
  { href: "/comps", label: "Sold comps", icon: Search, exact: false },
  { href: "/settings", label: "Settings", icon: Settings, exact: false },
];

export function Nav({ user }: { user: CurrentUser }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          <span className="text-emerald-400">Collectors</span> Ledger
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}

          <span className="ml-2 hidden text-xs text-slate-500 lg:inline" title={user.email}>
            {user.name || user.email}
          </span>
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
