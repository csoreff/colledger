import Link from "next/link";
import type { Grader, ItemStatus, ItemType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeItemFinancials } from "@/lib/profit";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  GRADER_LABELS,
  GRADERS,
  gradeLabel,
  ITEM_STATUS_LABELS,
  ITEM_STATUSES,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
} from "@/lib/labels";
import { Chip, EmptyState, PageHeader, ProfitValue } from "@/components/ui";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  type?: string;
  status?: string;
  grader?: string;
};

function statusTone(status: ItemStatus) {
  switch (status) {
    case "SOLD":
      return "emerald" as const;
    case "LISTED":
      return "sky" as const;
    case "RETURNED":
      return "amber" as const;
    case "LOST":
      return "rose" as const;
    default:
      return "slate" as const;
  }
}

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
      { certNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  if (searchParams.type && ITEM_TYPES.includes(searchParams.type as ItemType)) {
    where.type = searchParams.type as ItemType;
  }
  if (searchParams.status && ITEM_STATUSES.includes(searchParams.status as ItemStatus)) {
    where.status = searchParams.status as ItemStatus;
  }
  if (searchParams.grader && GRADERS.includes(searchParams.grader as Grader)) {
    where.grader = searchParams.grader as Grader;
  }

  const items = await prisma.item.findMany({
    where,
    include: { expenses: true, sales: true },
    orderBy: { acquiredAt: "desc" },
  });

  const hasFilters = Boolean(
    searchParams.q || searchParams.type || searchParams.status || searchParams.grader,
  );

  return (
    <>
      <PageHeader
        title="Collection"
        subtitle="Every card and manga you've bought, with what it cost and what it made."
        action={
          <Link href="/items/new" className="btn-primary">
            Add item
          </Link>
        }
      />

      <form method="get" className="card mb-6 grid grid-cols-1 gap-3 sm:grid-cols-5">
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
        <div className="flex gap-2 sm:col-span-5">
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
          title={hasFilters ? "No items match those filters" : "No items yet"}
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
          <table className="w-full min-w-[900px]">
            <thead className="border-b border-slate-800">
              <tr>
                <th className="th">Item</th>
                <th className="th">Grade</th>
                <th className="th">Acquired</th>
                <th className="th text-right">Paid</th>
                <th className="th text-right">Expenses</th>
                <th className="th text-right">Cost basis</th>
                <th className="th text-right">Proceeds</th>
                <th className="th text-right">Profit</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {items.map((item) => {
                const fin = computeItemFinancials(item);
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
                      </p>
                    </td>
                    <td className="td text-slate-300">
                      {gradeLabel(item.grader, item.grade, item.condition)}
                    </td>
                    <td className="td text-slate-400">{formatDate(item.acquiredAt)}</td>
                    <td className="td text-right tabular-nums">
                      {formatCents(fin.purchaseCents)}
                    </td>
                    <td className="td text-right tabular-nums text-slate-400">
                      {fin.itemExpenseCents > 0 ? formatCents(fin.itemExpenseCents) : "—"}
                    </td>
                    <td className="td text-right tabular-nums">
                      {formatCents(fin.costBasisCents)}
                    </td>
                    <td className="td text-right tabular-nums text-slate-400">
                      {fin.isRealized ? formatCents(fin.netProceedsCents) : "—"}
                    </td>
                    <td className="td text-right">
                      <ProfitValue cents={fin.profitCents} />
                    </td>
                    <td className="td">
                      <Chip tone={statusTone(item.status)}>
                        {ITEM_STATUS_LABELS[item.status]}
                      </Chip>
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
