import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { computeItemFinancials, computePortfolioTotals } from "@/lib/profit";
import { formatCents, formatPercent } from "@/lib/money";
import { formatDate, formatMonthKey, monthKey } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, gradeLabel, ITEM_TYPE_LABELS } from "@/lib/labels";
import { EmptyState, PageHeader, ProfitValue, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [items, generalExpenses] = await Promise.all([
    prisma.item.findMany({ include: { expenses: true, sales: true } }),
    prisma.expense.findMany({ where: { itemId: null } }),
  ]);

  const totals = computePortfolioTotals(items, generalExpenses);

  if (items.length === 0 && generalExpenses.length === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="Nothing tracked yet"
          description="Add your first card or manga to start tracking what you paid, what it cost you, and what it sold for."
          actionHref="/items/new"
          actionLabel="Add an item"
        />
      </>
    );
  }

  // --- Profit by month, keyed off sale date ---
  const byMonth = new Map<string, { profitCents: number; count: number }>();
  for (const item of items) {
    const fin = computeItemFinancials(item);
    if (!fin.isRealized) continue;
    // Attribute the whole item's profit to its most recent sale date.
    const lastSale = item.sales.reduce((latest, sale) =>
      sale.soldAt > latest.soldAt ? sale : latest,
    );
    const key = monthKey(lastSale.soldAt);
    const bucket = byMonth.get(key) ?? { profitCents: 0, count: 0 };
    bucket.profitCents += fin.profitCents ?? 0;
    bucket.count += 1;
    byMonth.set(key, bucket);
  }
  const months = Array.from(byMonth.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6);
  const peak = Math.max(1, ...months.map(([, m]) => Math.abs(m.profitCents)));

  // --- Expense breakdown across every expense, item-level and general ---
  const expenseGroups = await prisma.expense.groupBy({
    by: ["category"],
    _sum: { amountCents: true },
    orderBy: { _sum: { amountCents: "desc" } },
  });
  const expenseTotal = expenseGroups.reduce((sum, g) => sum + (g._sum.amountCents ?? 0), 0);

  const recentSales = await prisma.sale.findMany({
    take: 8,
    orderBy: { soldAt: "desc" },
    include: { item: { include: { expenses: true, sales: true } } },
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Everything you've bought, spent, and sold."
        action={
          <Link href="/items/new" className="btn-primary">
            Add item
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Net profit"
          value={formatCents(totals.netProfitCents)}
          hint="After item costs and general expenses"
          tone={totals.netProfitCents > 0 ? "positive" : totals.netProfitCents < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Sales proceeds"
          value={formatCents(totals.netProceedsCents)}
          hint={`${totals.soldCount} item${totals.soldCount === 1 ? "" : "s"} sold, after fees`}
        />
        <StatCard
          label="Inventory cost basis"
          value={formatCents(totals.inventoryCostBasisCents)}
          hint={`${totals.unsoldCount} item${totals.unsoldCount === 1 ? "" : "s"} still held`}
        />
        <StatCard
          label="Return on sold"
          value={formatPercent(totals.roi)}
          hint="Net profit ÷ cost basis of sold items"
          tone={totals.roi !== null && totals.roi > 0 ? "positive" : totals.roi !== null && totals.roi < 0 ? "negative" : "neutral"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total spent on items" value={formatCents(totals.totalCostBasisCents)} hint="Purchase price + item expenses" />
        <StatCard label="Profit before overhead" value={formatCents(totals.grossProfitCents)} hint="Sold items only" />
        <StatCard label="General expenses" value={formatCents(totals.generalExpenseCents)} hint="Not tied to any one item" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Profit by month
          </h2>
          {months.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No sales recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {months.map(([key, month]) => (
                <li key={key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-300">{formatMonthKey(key)}</span>
                    <span className="text-slate-500">
                      {month.count} sale{month.count === 1 ? "" : "s"}
                    </span>
                    <ProfitValue cents={month.profitCents} />
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${month.profitCents >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                      style={{ width: `${(Math.abs(month.profitCents) / peak) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Where the money went
          </h2>
          {expenseGroups.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No expenses recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {expenseGroups.map((group) => {
                const amount = group._sum.amountCents ?? 0;
                return (
                  <li key={group.category}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-slate-300">
                        {EXPENSE_CATEGORY_LABELS[group.category]}
                      </span>
                      <span className="tabular-nums text-slate-200">
                        {formatCents(amount)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{ width: `${(amount / Math.max(1, expenseTotal)) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Recent sales
        </h2>
        {recentSales.length === 0 ? (
          <div className="card text-sm text-slate-500">No sales recorded yet.</div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className="th">Item</th>
                  <th className="th">Sold</th>
                  <th className="th text-right">Sale price</th>
                  <th className="th text-right">Cost basis</th>
                  <th className="th text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {recentSales.map((sale) => {
                  const fin = computeItemFinancials(sale.item);
                  return (
                    <tr key={sale.id} className="hover:bg-slate-800/30">
                      <td className="td">
                        <Link href={`/items/${sale.itemId}`} className="hover:text-emerald-400">
                          {sale.item.title}
                        </Link>
                        <p className="text-xs text-slate-500">
                          {ITEM_TYPE_LABELS[sale.item.type]} ·{" "}
                          {gradeLabel(sale.item.grader, sale.item.grade, sale.item.condition)}
                        </p>
                      </td>
                      <td className="td text-slate-400">{formatDate(sale.soldAt)}</td>
                      <td className="td text-right tabular-nums">
                        {formatCents(sale.grossPriceCents)}
                        {sale.wasBestOffer ? (
                          <span className="ml-1 text-xs text-amber-400">offer</span>
                        ) : null}
                      </td>
                      <td className="td text-right tabular-nums text-slate-400">
                        {formatCents(fin.costBasisCents)}
                      </td>
                      <td className="td text-right">
                        <ProfitValue cents={fin.profitCents} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
