import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { getCurrentUser } from "@/lib/tenant";
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

  return (
    <html lang="en">
      <body className={inter.className}>
        {user ? <Nav user={user} /> : null}
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
