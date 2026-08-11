import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  computeItemFinancials,
  computePortfolioTotals,
  saleGrossMoney,
} from "@/lib/profit";
import { formatPercent, type Money } from "@/lib/currency";
import { formatDate, formatMonthKey, monthKey } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, gradeLabel, ITEM_TYPE_LABELS } from "@/lib/labels";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { MoneyProfit, MoneyValue } from "@/components/Money";

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
  const byMonth = new Map<string, { profit: Money; count: number }>();
  for (const item of items) {
    const fin = computeItemFinancials(item);
    if (!fin.isRealized) continue;
    // Attribute the whole item's profit to its most recent sale date.
    const lastSale = item.sales.reduce((latest, sale) =>
      sale.soldAt > latest.soldAt ? sale : latest,
    );
    const key = monthKey(lastSale.soldAt);
    const bucket = byMonth.get(key) ?? { profit: { usdCents: 0, jpyYen: 0 }, count: 0 };
    bucket.profit = {
      usdCents: bucket.profit.usdCents + (fin.profit?.usdCents ?? 0),
      jpyYen: bucket.profit.jpyYen + (fin.profit?.jpyYen ?? 0),
    };
    bucket.count += 1;
    byMonth.set(key, bucket);
  }
  const months = Array.from(byMonth.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6);
  const peak = Math.max(1, ...months.map(([, m]) => Math.abs(m.profit.usdCents)));

  // --- Expense breakdown across every expense, item-level and general ---
  const expenseGroups = await prisma.expense.groupBy({
    by: ["category"],
    _sum: { amountUsdCents: true, amountJpyYen: true },
    orderBy: { _sum: { amountUsdCents: "desc" } },
  });
  const expenseTotal = expenseGroups.reduce(
    (sum, g) => sum + (g._sum.amountUsdCents ?? 0),
    0,
  );

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
          value={<MoneyValue money={totals.netProfit} align="left" />}
          hint="After item costs and general expenses"
          tone={totals.netProfit.usdCents > 0 ? "positive" : totals.netProfit.usdCents < 0 ? "negative" : "neutral"}
        />
        <StatCard
          label="Sales proceeds"
          value={<MoneyValue money={totals.netProceeds} align="left" />}
          hint={`${totals.soldCount} item${totals.soldCount === 1 ? "" : "s"} sold, after fees`}
        />
        <StatCard
          label="Inventory cost basis"
          value={<MoneyValue money={totals.inventoryCostBasis} align="left" />}
          hint={`${totals.unsoldCount} item${totals.unsoldCount === 1 ? "" : "s"} still held`}
        />
        <StatCard
          label="Return on sold"
          value={formatPercent(totals.roi.usd)}
          hint={`Net profit ÷ cost basis of sold items · ${formatPercent(totals.roi.jpy)} in JPY`}
          tone={totals.roi.usd !== null && totals.roi.usd > 0 ? "positive" : totals.roi.usd !== null && totals.roi.usd < 0 ? "negative" : "neutral"}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total spent on items" value={<MoneyValue money={totals.totalCostBasis} align="left" />} hint="Purchase price + item expenses" />
        <StatCard label="Profit before overhead" value={<MoneyValue money={totals.grossProfit} align="left" />} hint="Sold items only" />
        <StatCard label="General expenses" value={<MoneyValue money={totals.generalExpenses} align="left" />} hint="Not tied to any one item" />
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
                    <MoneyProfit money={month.profit} />
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${month.profit.usdCents >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                      style={{ width: `${(Math.abs(month.profit.usdCents) / peak) * 100}%` }}
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
                const amount: Money = {
                  usdCents: group._sum.amountUsdCents ?? 0,
                  jpyYen: group._sum.amountJpyYen ?? 0,
                };
                return (
                  <li key={group.category}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-slate-300">
                        {EXPENSE_CATEGORY_LABELS[group.category]}
                      </span>
                      <MoneyValue money={amount} />
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-sky-500"
                        style={{ width: `${(amount.usdCents / Math.max(1, expenseTotal)) * 100}%` }}
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
                      <td className="td text-right">
                        <MoneyValue money={saleGrossMoney(sale)} primary={sale.currency} />
                        {sale.wasBestOffer ? (
                          <span className="text-xs text-amber-400">offer</span>
                        ) : null}
                      </td>
                      <td className="td text-right">
                        <MoneyValue money={fin.costBasis} />
                      </td>
                      <td className="td text-right">
                        <MoneyProfit money={fin.profit} />
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
