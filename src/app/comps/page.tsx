import { AlertTriangle, ExternalLink, Info } from "lucide-react";
import type { Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildCacheKey, getProvider, runCompSearch, summarizeComps } from "@/lib/comps";
import { deleteComp, refreshComps } from "@/lib/actions";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  GRADER_LABELS,
  GRADERS,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
} from "@/lib/labels";
import { Chip, PageHeader, StatCard } from "@/components/ui";
import { CompPriceEditor } from "@/components/CompPriceEditor";
import { DeleteButton } from "@/components/DeleteButton";
import { ManualCompForm } from "@/components/ManualCompForm";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  itemType?: string;
  grader?: string;
  grade?: string;
};

export default async function CompsPage({ searchParams }: { searchParams: SearchParams }) {
  const provider = getProvider();
  const unavailable = provider.unavailableReason();

  const query = searchParams.q?.trim() ?? "";
  const itemType = ITEM_TYPES.includes(searchParams.itemType as ItemType)
    ? (searchParams.itemType as ItemType)
    : null;
  const grader = GRADERS.includes(searchParams.grader as Grader)
    ? (searchParams.grader as Grader)
    : null;
  const grade = searchParams.grade?.trim() || null;

  let searchId: string | null = null;
  let warning: string | null = null;

  if (query) {
    const compQuery = { query, itemType, grader, grade };
    const cacheKey = buildCacheKey(compQuery, provider.id);
    const existing = await prisma.compSearch.findUnique({ where: { cacheKey } });

    if (existing) {
      // Reuse whatever we already have; the Refresh button forces a re-fetch.
      searchId = existing.id;
      warning = existing.warning;
    } else {
      const result = await runCompSearch(compQuery);
      searchId = result.searchId;
      warning = result.warning;
    }
  }

  const comps = searchId
    ? await prisma.soldComp.findMany({
        where: { searchId },
        orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
      })
    : [];

  const stats = summarizeComps(comps);

  return (
    <>
      <PageHeader
        title="Sold comps"
        subtitle="Recent sold prices for a card or manga — graded or raw."
      />

      {/* Provider status: be explicit about what the numbers can and can't be. */}
      <div className="card mb-6 flex gap-3 border-slate-800 bg-slate-900/40">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
        <div className="text-sm text-slate-400">
          <p>
            Provider: <span className="text-slate-200">{provider.label}</span>
            {provider.resolvesBestOffer ? (
              <span className="ml-2">
                <Chip tone="emerald">Reports true Best Offer prices</Chip>
              </span>
            ) : (
              <span className="ml-2">
                <Chip tone="amber">Best Offer prices not resolvable</Chip>
              </span>
            )}
          </p>
          {unavailable ? (
            <p className="mt-2 text-amber-300">{unavailable}</p>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">
            eBay hides accepted Best Offer amounts on sold listings and blocks scripted
            access to its search pages. The Marketplace Insights API reports the amount
            actually transacted — including accepted offers — which is why it&apos;s the
            provider this app targets. Anything it can&apos;t resolve you can fill in by hand,
            and your number takes precedence.
          </p>
        </div>
      </div>

      <form method="get" className="card mb-6 grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <label className="label">Card or manga</label>
          <input
            name="q"
            defaultValue={query}
            required
            placeholder="Chainsaw Man vol 1 first print"
            className="input"
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select name="itemType" defaultValue={itemType ?? ""} className="input">
            <option value="">Any</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Graded / raw</label>
          <select name="grader" defaultValue={grader ?? ""} className="input">
            <option value="">Any</option>
            {GRADERS.map((g) => (
              <option key={g} value={g}>
                {GRADER_LABELS[g]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Grade</label>
          <input name="grade" defaultValue={grade ?? ""} placeholder="10" className="input" />
        </div>
        <div className="sm:col-span-5">
          <button type="submit" className="btn-primary">
            Search sold comps
          </button>
        </div>
      </form>

      {warning ? (
        <div className="mb-6 flex gap-3 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-sm text-amber-200">{warning}</p>
        </div>
      ) : null}

      {!query ? (
        <div className="card py-14 text-center text-sm text-slate-500">
          Search above to pull recent sold prices.
        </div>
      ) : (
        <>
          {stats ? (
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label="Median sold"
                value={formatCents(stats.medianCents)}
                hint={`${stats.confirmedCount} confirmed price${stats.confirmedCount === 1 ? "" : "s"}`}
              />
              <StatCard label="Average" value={formatCents(stats.meanCents)} />
              <StatCard label="Low" value={formatCents(stats.minCents)} />
              <StatCard label="High" value={formatCents(stats.maxCents)} />
            </div>
          ) : null}

          {stats && stats.unconfirmedCount > 0 ? (
            <p className="mb-4 text-sm text-amber-300">
              {stats.unconfirmedCount} listing
              {stats.unconfirmedCount === 1 ? " is" : "s are"} excluded from these stats —
              they closed via Best Offer at a price eBay hides. Set the true price on a row
              to include it.
            </p>
          ) : null}

          <section className="card mb-6 p-0">
            {comps.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">
                No comps stored for this search yet. Add them by hand below.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead className="border-b border-slate-800">
                    <tr>
                      <th className="th">Listing</th>
                      <th className="th">Sold</th>
                      <th className="th">Grade</th>
                      <th className="th text-right">Asking</th>
                      <th className="th text-right">Sold for</th>
                      <th className="th" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {comps.map((comp) => (
                      <tr key={comp.id} className="hover:bg-slate-800/30">
                        <td className="td max-w-md">
                          {comp.url ? (
                            <a
                              href={comp.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-start gap-1 hover:text-emerald-400"
                            >
                              <span className="line-clamp-2">{comp.title}</span>
                              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-slate-600" />
                            </a>
                          ) : (
                            <span className="line-clamp-2">{comp.title}</span>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1">
                            {comp.wasBestOffer ? <Chip tone="amber">Best Offer</Chip> : null}
                            {comp.provider === "manual-entry" ? (
                              <Chip tone="sky">Added by you</Chip>
                            ) : null}
                          </div>
                        </td>
                        <td className="td text-slate-400">{formatDate(comp.soldAt)}</td>
                        <td className="td text-slate-300">
                          {comp.grader && comp.grader !== "RAW"
                            ? `${comp.grader}${comp.grade ? ` ${comp.grade}` : ""}`
                            : (comp.condition ?? "Raw")}
                        </td>
                        <td className="td text-right tabular-nums text-slate-500">
                          {comp.listedPriceCents !== null
                            ? formatCents(comp.listedPriceCents)
                            : !comp.priceIsConfirmed
                              ? formatCents(comp.salePriceCents)
                              : "—"}
                        </td>
                        <td className="td text-right">
                          <CompPriceEditor
                            compId={comp.id}
                            salePriceCents={comp.salePriceCents}
                            manualPriceCents={comp.manualPriceCents}
                            priceIsConfirmed={comp.priceIsConfirmed}
                          />
                        </td>
                        <td className="td text-right">
                          <DeleteButton
                            action={deleteComp.bind(null, comp.id)}
                            label="Delete comp"
                            confirmMessage="Remove this comp?"
                            iconOnly
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mb-6">
            <form action={refreshComps}>
              <input type="hidden" name="query" value={query} />
              <input type="hidden" name="itemType" value={itemType ?? ""} />
              <input type="hidden" name="grader" value={grader ?? ""} />
              <input type="hidden" name="grade" value={grade ?? ""} />
              <button type="submit" className="btn-secondary">
                Refresh from {provider.label}
              </button>
            </form>
          </div>

          {searchId ? (
            <section className="card">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
                Add a comp by hand
              </h2>
              <ManualCompForm searchId={searchId} />
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
