import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getShowcase } from "@/lib/showcase";
import { getCurrentUser } from "@/lib/tenant";
import { gradeLabel, ITEM_TYPE_LABELS } from "@/lib/labels";
import { Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const showcase = await getShowcase(params.slug);
  if (!showcase) return { title: "Not found" };

  return {
    title: `${showcase.ownerName}'s collection · Collectors Ledger`,
    description: `${showcase.totals.titles} titles, ${showcase.totals.cards} cards.`,
  };
}

/**
 * A public, signed-out view of one person's held collection.
 *
 * Everything rendered comes from `getShowcase`, which selects an explicit
 * allowlist of columns — there is no money, no acquisition date and no private
 * note anywhere in the returned shape, so nothing here can print one. See the
 * header comment in `src/lib/showcase.ts`.
 */
export default async function ShowcasePage({ params }: Params) {
  const showcase = await getShowcase(params.slug);

  // A disabled showcase and a slug nobody owns are the same 404, so this URL
  // space can't be probed to learn which accounts exist.
  if (!showcase) notFound();

  // Only to decide whether to offer a link back into the app; the page content
  // is identical either way.
  const viewer = await getCurrentUser();

  // No outer container: the root layout already centres and pads `<main>`, and
  // it renders the nav only for a signed-in viewer, so a visitor sees the
  // collection on its own.
  return (
    <>
      <header className="mb-8 border-b border-slate-800 pb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-400">
          Collection
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {showcase.ownerName}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {showcase.totals.titles} title{showcase.totals.titles === 1 ? "" : "s"} ·{" "}
          {showcase.totals.cards} card{showcase.totals.cards === 1 ? "" : "s"} held
        </p>
      </header>

      {showcase.items.length === 0 ? (
        <div className="card py-14 text-center">
          <p className="text-base font-medium text-slate-200">Nothing on display yet</p>
          <p className="mt-1 text-sm text-slate-400">
            This collection has no held items to show.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {showcase.items.map((item) => (
            <li key={item.id} className="card flex flex-col">
              {item.imageUrl ? (
                <a
                  href={item.imageUrl}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="mb-3 block overflow-hidden rounded-lg bg-slate-950"
                >
                  {/* A plain <img>: these are arbitrary third-party URLs the
                      owner pasted in, and next/image would need every one of
                      those hosts allowlisted in next.config. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="mx-auto h-44 w-full object-contain"
                  />
                </a>
              ) : null}

              <h2 className="text-sm font-medium leading-snug text-slate-100">
                {item.title}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {[
                  ITEM_TYPE_LABELS[item.type],
                  item.setName,
                  item.number ? `#${item.number}` : null,
                  item.variant,
                  item.language,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              <div className="mt-3 flex flex-wrap gap-1">
                {item.copies.map((copy) => (
                  <Chip key={copy.id} tone={copy.grader === "RAW" ? "slate" : "emerald"}>
                    {gradeLabel(copy.grader, copy.grade, copy.condition)}
                    {copy.quantity > 1 ? ` ×${copy.quantity}` : ""}
                  </Chip>
                ))}
              </div>

              {/* Cert numbers are printed on the slab and verifiable in the
                  grader's public database, so they are safe to show. */}
              {item.copies.some((c) => c.certNumber) ? (
                <p className="mt-2 font-mono text-[11px] text-slate-600">
                  {item.copies
                    .filter((c) => c.certNumber)
                    .map((c) => c.certNumber)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-12 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
        <p>
          Tracked with{" "}
          <Link href={viewer ? "/" : "/login"} className="hover:text-slate-400">
            Collectors Ledger
          </Link>
        </p>
      </footer>
    </>
  );
}
