import Link from "next/link";
import type { Grader, ItemStatus, ItemType, Marketplace, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeItemRollup } from "@/lib/profit";
import { formatDate } from "@/lib/dates";
import {
  GRADER_LABELS,
  GRADERS,
  gradeLabel,
  ITEM_STATUS_LABELS,
  ITEM_STATUSES,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  MARKETPLACE_LABELS,
  MARKETPLACES,
} from "@/lib/labels";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { MoneyProfit, MoneyValue } from "@/components/Money";
import { SortableHeader, type SortDirection } from "@/components/SortableHeader";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  type?: string;
  status?: string;
  grader?: string;
  source?: string;
  sort?: string;
  dir?: string;
};

/**
 * Sortable columns. Money is compared in USD: both currencies are stored, but a
 * single ordering has to pick one, and the rate moved between purchases so the
 * two orderings are not identical.
 */
const SORT_KEYS = [
  "recent",
  "title",
  "cards",
  "first",
  "basis",
  "held",
  "proceeds",
  "profit",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const where: Prisma.ItemWhereInput = {};

  if (searchParams.q) {
    const q = searchParams.q;
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { setName: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } },
      { purchases: { some: { certNumber: { contains: q, mode: "insensitive" } } } },
    ];
  }
  if (searchParams.type && ITEM_TYPES.includes(searchParams.type as ItemType)) {
    where.type = searchParams.type as ItemType;
  }

  // Copy-level filters match a card when *any* of its copies qualify, since the
  // list shows one row per card.
  const purchaseFilter: Prisma.PurchaseWhereInput = {};
  if (searchParams.status && ITEM_STATUSES.includes(searchParams.status as ItemStatus)) {
    purchaseFilter.status = searchParams.status as ItemStatus;
  }
  if (searchParams.grader && GRADERS.includes(searchParams.grader as Grader)) {
    purchaseFilter.grader = searchParams.grader as Grader;
  }
  if (searchParams.source && MARKETPLACES.includes(searchParams.source as Marketplace)) {
    purchaseFilter.purchaseSource = searchParams.source as Marketplace;
  }
  if (Object.keys(purchaseFilter).length > 0) {
    where.purchases = { some: purchaseFilter };
  }

  const items = await prisma.item.findMany({
    where,
    include: {
      purchases: {
        orderBy: [{ acquiredAt: "asc" }, { id: "asc" }],
        include: { expenses: true, sales: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Rollups are computed in JS rather than stored, so ordering by any money
  // column has to happen here rather than in the query.
  const sort: SortKey = SORT_KEYS.includes(searchParams.sort as SortKey)
    ? (searchParams.sort as SortKey)
    : "recent";
  const dir: SortDirection = searchParams.dir === "asc" ? "asc" : "desc";

  const rows = items.map((item) => ({ item, rollup: computeItemRollup(item) }));

  if (sort !== "recent") {
    const sign = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      switch (sort) {
        case "title":
          return sign * a.item.title.localeCompare(b.item.title);
        case "cards":
          // Sort by the number the cell actually leads with — cards still held
          // — so the visible order reads monotonically. Total ever owned only
          // breaks ties.
          return (
            sign * (a.rollup.heldUnits - b.rollup.heldUnits) ||
            sign * (a.rollup.units - b.rollup.units)
          );
        case "first": {
          const at = a.item.purchases[0]?.acquiredAt.getTime() ?? 0;
          const bt = b.item.purchases[0]?.acquiredAt.getTime() ?? 0;
          return sign * (at - bt);
        }
        case "basis":
          return sign * (a.rollup.costBasis.usdCents - b.rollup.costBasis.usdCents);
        case "held":
          return (
            sign *
            (a.rollup.inventoryCostBasis.usdCents - b.rollup.inventoryCostBasis.usdCents)
          );
        case "proceeds":
          return sign * (a.rollup.netProceeds.usdCents - b.rollup.netProceeds.usdCents);
        case "profit": {
          // Cards with nothing sold have no profit; keep them last either way
          // rather than letting them lead an ascending sort.
          const ap = a.rollup.realizedProfit;
          const bp = b.rollup.realizedProfit;
          if (ap === null && bp === null) return 0;
          if (ap === null) return 1;
          if (bp === null) return -1;
          return sign * (ap.usdCents - bp.usdCents);
        }
        default:
          return 0;
      }
    });
  }

  // Everything except the sort state, so headers keep the active filters.
  const filterParams = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value && key !== "sort" && key !== "dir") filterParams.set(key, value);
  }

  const hasFilters = Boolean(
    searchParams.q ||
      searchParams.type ||
      searchParams.status ||
      searchParams.grader ||
      searchParams.source,
  );

  return (
    <>
      <PageHeader
        title="Collection"
        subtitle="One row per card. Click a column heading to sort; money sorts by its USD value."
        action={
          <Link href="/items/new" className="btn-primary">
            Add item
          </Link>
        }
      />

      <form method="get" className="card mb-6 grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="label">Search</label>
          <input
            key={`q-${searchParams.q ?? ""}`}
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Title, set, number, cert…"
            className="input"
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            key={`type-${searchParams.type ?? ""}`}
            name="type"
            defaultValue={searchParams.type ?? ""}
            className="input"
          >
            <option value="">All</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {ITEM_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Grading</label>
          <select
            key={`grader-${searchParams.grader ?? ""}`}
            name="grader"
            defaultValue={searchParams.grader ?? ""}
            className="input"
          >
            <option value="">All</option>
            {GRADERS.map((g) => (
              <option key={g} value={g}>
                {GRADER_LABELS[g]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select
            key={`status-${searchParams.status ?? ""}`}
            name="status"
            defaultValue={searchParams.status ?? ""}
            className="input"
          >
            <option value="">All</option>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ITEM_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bought from</label>
          <select
            key={`source-${searchParams.source ?? ""}`}
            name="source"
            defaultValue={searchParams.source ?? ""}
            className="input"
          >
            <option value="">All</option>
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {MARKETPLACE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        {sort !== "recent" ? (
          <>
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="dir" value={dir} />
          </>
        ) : null}
        <div className="flex gap-2 sm:col-span-6">
          <button type="submit" className="btn-primary">
            Apply filters
          </button>
          {hasFilters ? (
            <Link
              href={`/items?${new URLSearchParams(
                sort === "recent" ? {} : { sort, dir },
              ).toString()}`}
              className="btn-secondary"
            >
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      {items.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No cards match those filters" : "No items yet"}
          description={
            hasFilters
              ? "Try widening the search or clearing the filters."
              : "Add your first card or manga to start tracking costs and profit."
          }
          actionHref={hasFilters ? undefined : "/items/new"}
          actionLabel={hasFilters ? undefined : "Add an item"}
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[940px]">
            <thead className="border-b border-slate-800">
              <tr>
                <SortableHeader
                  label="Card"
                  sortKey="title"
                  defaultDir="asc"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
                <SortableHeader
                  label="Cards"
                  sortKey="cards"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
                <th className="th">Grades held</th>
                <SortableHeader
                  label="First bought"
                  sortKey="first"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
                <SortableHeader
                  label="Cost basis"
                  sortKey="basis"
                  align="right"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
                <SortableHeader
                  label="Still held"
                  sortKey="held"
                  align="right"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
                <SortableHeader
                  label="Proceeds"
                  sortKey="proceeds"
                  align="right"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
                <SortableHeader
                  label="Realized profit"
                  sortKey="profit"
                  align="right"
                  activeSort={sort}
                  activeDir={dir}
                  params={filterParams}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map(({ item, rollup }) => {
                const first = item.purchases[0];
                // Distinct grade labels across copies, e.g. "PSA 10 · Raw · ARS 10+".
                const grades = Array.from(
                  new Set(
                    item.purchases.map((p) =>
                      gradeLabel(p.grader, p.grade, p.condition),
                    ),
                  ),
                );

                return (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="td">
                      <Link
                        href={`/items/${item.id}`}
                        className="font-medium hover:text-emerald-400"
                      >
                        {item.title}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {ITEM_TYPE_LABELS[item.type]}
                        {item.setName ? ` · ${item.setName}` : ""}
                        {item.number ? ` #${item.number}` : ""}
                        {item.variant ? ` · ${item.variant}` : ""}
                      </p>
                    </td>
                    <td className="td">
                      <span className="flex flex-wrap gap-1">
                        {rollup.heldUnits > 0 ? (
                          <Chip tone="sky">{rollup.heldUnits} held</Chip>
                        ) : null}
                        {rollup.soldUnits > 0 ? (
                          <Chip tone="emerald">{rollup.soldUnits} sold</Chip>
                        ) : null}
                      </span>
                      {rollup.units !== rollup.copies ? (
                        <p className="mt-1 text-xs text-slate-500">
                          across {rollup.copies} purchase
                          {rollup.copies === 1 ? "" : "s"}
                        </p>
                      ) : null}
                    </td>
                    <td className="td text-xs text-slate-400">
                      {grades.slice(0, 3).join(" · ")}
                      {grades.length > 3 ? ` +${grades.length - 3}` : ""}
                    </td>
                    <td className="td text-slate-400">
                      {first ? formatDate(first.acquiredAt) : "—"}
                    </td>
                    <td className="td text-right">
                      <MoneyValue money={rollup.costBasis} />
                    </td>
                    <td className="td text-right">
                      {rollup.heldCount > 0 ? (
                        <MoneyValue money={rollup.inventoryCostBasis} />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="td text-right">
                      {rollup.soldCount > 0 ? (
                        <MoneyValue money={rollup.netProceeds} />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="td text-right">
                      <MoneyProfit money={rollup.realizedProfit} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
