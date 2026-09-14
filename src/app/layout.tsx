import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { getCurrentUser, getDisplayName } from "@/lib/tenant";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Collectors Ledger",
  description: "Track trading card & manga purchases, sales, expenses and profit.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read here rather than inside Nav so the login and register pages, which
  // share this layout, render without a navigation bar they can't use.
  const user = await getCurrentUser();

  // The name comes from the database, not the session: the JWT holds whatever
  // it was at sign-in, so the nav would otherwise keep showing the old name
  // after someone renames themselves in Settings.
  const displayName = user ? await getDisplayName(user.id) : null;

  return (
    <html lang="en">
      <body className={inter.className}>
        {user ? <Nav user={user} displayName={displayName} /> : null}
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
