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

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  type?: string;
  status?: string;
  grader?: string;
  source?: string;
};

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
        orderBy: { acquiredAt: "asc" },
        include: { expenses: true, sales: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

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
        subtitle="One row per card. Open a card to see every copy you've bought."
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
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="Title, set, number, cert…"
            className="input"
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select name="type" defaultValue={searchParams.type ?? ""} className="input">
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
          <select name="grader" defaultValue={searchParams.grader ?? ""} className="input">
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
          <select name="status" defaultValue={searchParams.status ?? ""} className="input">
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
          <select name="source" defaultValue={searchParams.source ?? ""} className="input">
            <option value="">All</option>
            {MARKETPLACES.map((m) => (
              <option key={m} value={m}>
                {MARKETPLACE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 sm:col-span-6">
          <button type="submit" className="btn-primary">
            Apply filters
          </button>
          {hasFilters ? (
            <Link href="/items" className="btn-secondary">
              Clear
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
                <th className="th">Card</th>
                <th className="th">Cards</th>
                <th className="th">Grades held</th>
                <th className="th">First bought</th>
                <th className="th text-right">Cost basis</th>
                <th className="th text-right">Still held</th>
                <th className="th text-right">Proceeds</th>
                <th className="th text-right">Realized profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {items.map((item) => {
                const rollup = computeItemRollup(item);
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
