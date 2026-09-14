import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getShowcase,
  SHOWCASE_SORT_LABELS,
  SHOWCASE_SORTS,
} from "@/lib/showcase";
import { getCurrentUser } from "@/lib/tenant";
import { GRADER_LABELS, gradeLabel, ITEM_TYPE_LABELS } from "@/lib/labels";
import { Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  type?: string;
  grader?: string;
  language?: string;
  sort?: string;
};

type Params = {
  params: { slug: string };
  searchParams: SearchParams;
};

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  // Unfiltered on purpose: the title and description describe the collection,
  // not whatever a particular visitor happened to search for.
  const showcase = await getShowcase(params.slug);
  if (!showcase) return { title: "Not found" };

  return {
    title: `${showcase.ownerName}'s collection · Collectors Ledger`,
    description: `${showcase.unfiltered.titles} titles, ${showcase.unfiltered.cards} cards.`,
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
export default async function ShowcasePage({ params, searchParams }: Params) {
  const showcase = await getShowcase(params.slug, searchParams);

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
          {showcase.isFiltered ? (
            <>
              Showing {showcase.totals.titles} of {showcase.unfiltered.titles} title
              {showcase.unfiltered.titles === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {showcase.unfiltered.titles} title{showcase.unfiltered.titles === 1 ? "" : "s"} ·{" "}
              {showcase.unfiltered.cards} card
              {showcase.unfiltered.cards === 1 ? "" : "s"} held
            </>
          )}
        </p>
      </header>

      {/* A plain GET form: every view is a shareable URL, it works without
          JavaScript, and there is no state to keep in sync. */}
      <form method="get" className="card mb-6 grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label">Search</label>
          <input
            key={`q-${showcase.filters.q ?? ""}`}
            name="q"
            defaultValue={showcase.filters.q ?? ""}
            placeholder="Title, set, number, cert…"
            className="input"
          />
        </div>

        {showcase.facets.types.length > 1 ? (
          <div>
            <label className="label">Type</label>
            <select
              key={`type-${showcase.filters.type ?? ""}`}
              name="type"
              defaultValue={showcase.filters.type ?? ""}
              className="input"
            >
              <option value="">All</option>
              {showcase.facets.types.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {showcase.facets.graders.length > 1 ? (
          <div>
            <label className="label">Grading</label>
            <select
              key={`grader-${showcase.filters.grader ?? ""}`}
              name="grader"
              defaultValue={showcase.filters.grader ?? ""}
              className="input"
            >
              <option value="">All</option>
              {showcase.facets.graders.map((g) => (
                <option key={g} value={g}>
                  {GRADER_LABELS[g]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {showcase.facets.languages.length > 1 ? (
          <div>
            <label className="label">Language</label>
            <select
              key={`language-${showcase.filters.language ?? ""}`}
              name="language"
              defaultValue={showcase.filters.language ?? ""}
              className="input"
            >
              <option value="">All</option>
              {showcase.facets.languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="label">Sort</label>
          <select
            key={`sort-${showcase.filters.sort ?? ""}`}
            name="sort"
            defaultValue={showcase.filters.sort ?? "title"}
            className="input"
          >
            {SHOWCASE_SORTS.map((s) => (
              <option key={s} value={s}>
                {SHOWCASE_SORT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 sm:col-span-6">
          <button type="submit" className="btn-primary">
            Apply
          </button>
          {showcase.isFiltered ? (
            <Link href={`/showcase/${showcase.slug}`} className="btn-secondary">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {showcase.items.length === 0 ? (
        <div className="card py-14 text-center">
          <p className="text-base font-medium text-slate-200">
            {showcase.isFiltered ? "Nothing matches those filters" : "Nothing on display yet"}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {showcase.isFiltered
              ? "Try a different search, or clear the filters."
              : "This collection has no held items to show."}
          </p>
          {showcase.isFiltered ? (
            <Link href={`/showcase/${showcase.slug}`} className="btn-secondary mt-5">
              Clear filters
            </Link>
          ) : null}
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
