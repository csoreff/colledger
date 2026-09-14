import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/tenant";
import { Chip, PageHeader } from "@/components/ui";
import { ApiKeyManager, ChangePasswordForm } from "@/components/ApiKeys";
import { ShowcaseSettings } from "@/components/ShowcaseSettings";
import { ProfileSettings } from "@/components/ProfileSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();

  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, email: true, publicShowcase: true, publicSlug: true },
  });

  // The showcase URL has to be absolute to be shareable, and the host is only
  // knowable at request time — a hardcoded origin would be wrong on every
  // preview deployment.
  const host = headers().get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const origin = `${protocol}://${host}`;

  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={user.email}
        action={user.role === "ADMIN" ? <Chip tone="amber">Admin</Chip> : undefined}
      />

      <section className="card mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Profile
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          How you&apos;re identified in the app.
        </p>
        <ProfileSettings
          name={account?.name ?? null}
          email={account?.email ?? user.email}
          showcaseSlug={account?.publicShowcase ? account.publicSlug : null}
        />
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Public collection
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Share what you own without sharing what it cost you.
        </p>
        <ShowcaseSettings
          enabled={account?.publicShowcase ?? false}
          slug={account?.publicSlug ?? null}
          origin={origin}
        />
      </section>

      <ApiKeyManager keys={keys} role={user.role} />

      <section className="card mb-6">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Using the API
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Send the key as a bearer token. Full reference in{" "}
          <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">docs/API.md</code>.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-xs text-slate-300">
{`curl -H "Authorization: Bearer cl_…" \\
     https://your-app.vercel.app/api/v1/stats

curl -X POST https://your-app.vercel.app/api/v1/import \\
     -H "Authorization: Bearer cl_…" \\
     -H "Content-Type: application/json" \\
     -d @ledger.json`}
        </pre>
        {user.role === "ADMIN" ? (
          <p className="mt-4 text-sm text-slate-500">
            A key with the admin scope can act on any account by adding{" "}
            <code className="rounded bg-slate-800 px-1 py-0.5 text-xs">
              X-Ledger-User: someone@example.com
            </code>
            .
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Change password
        </h2>
        <ChangePasswordForm />
      </section>

      <p className="mt-6 text-center text-xs text-slate-600">
        <Link href="/" className="hover:text-slate-400">
          Back to the dashboard
        </Link>
      </p>
    </>
  );
}
