import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { deleteExpense } from "@/lib/actions";
import type { Money } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, gradeLabel } from "@/lib/labels";
import { expenseMoney } from "@/lib/profit";
import { PageHeader, StatCard } from "@/components/ui";
import { MoneyValue } from "@/components/Money";
import { DeleteButton } from "@/components/DeleteButton";
import { ExpenseForm } from "@/components/ExpenseForm";

export const dynamic = "force-dynamic";

type SearchParams = { scope?: string };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const scope = searchParams.scope === "item" ? "item" : searchParams.scope === "all" ? "all" : "general";

  const where =
    scope === "general"
      ? { purchaseId: null }
      : scope === "item"
        ? { NOT: { purchaseId: null } }
        : {};

  const [expenses, generalAgg, itemAgg] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { incurredAt: "desc" },
      include: {
        purchase: {
          select: {
            id: true,
            grader: true,
            grade: true,
            condition: true,
            item: { select: { id: true, title: true } },
          },
        },
      },
    }),
    prisma.expense.aggregate({
      where: { purchaseId: null },
      _sum: { amountUsdCents: true, amountJpyYen: true },
    }),
    prisma.expense.aggregate({
      where: { NOT: { purchaseId: null } },
      _sum: { amountUsdCents: true, amountJpyYen: true },
    }),
  ]);

  const generalTotal: Money = {
    usdCents: generalAgg._sum.amountUsdCents ?? 0,
    jpyYen: generalAgg._sum.amountJpyYen ?? 0,
  };
  const itemTotal: Money = {
    usdCents: itemAgg._sum.amountUsdCents ?? 0,
    jpyYen: itemAgg._sum.amountJpyYen ?? 0,
  };
  const shownTotal: Money = expenses.reduce(
    (sum, e) => ({
      usdCents: sum.usdCents + e.amountUsdCents,
      jpyYen: sum.jpyYen + e.amountJpyYen,
    }),
    { usdCents: 0, jpyYen: 0 },
  );

  const TABS = [
    { key: "general", label: "General only" },
    { key: "item", label: "Copy-specific" },
    { key: "all", label: "All" },
  ] as const;

  return (
    <>
      <PageHeader
        title="Expenses"
        subtitle="General overhead lives here. Costs for a specific copy are added on that card's page."
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="General expenses"
          value={<MoneyValue money={generalTotal} align="left" />}
          hint="Not tied to any one item"
        />
        <StatCard
          label="Copy expenses"
          value={<MoneyValue money={itemTotal} align="left" />}
          hint="Rolled into each copy's cost basis"
        />
        <StatCard
          label="All expenses"
          value={
            <MoneyValue
              money={{
                usdCents: generalTotal.usdCents + itemTotal.usdCents,
                jpyYen: generalTotal.jpyYen + itemTotal.jpyYen,
              }}
              align="left"
            />
          }
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/expenses?scope=${tab.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              scope === tab.key
                ? "bg-emerald-500/10 text-emerald-300"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <section className="card mb-6 p-0">
        {expenses.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No expenses in this view yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Category</th>
                  <th className="th">Description</th>
                  <th className="th">Applies to</th>
                  <th className="th">Vendor</th>
                  <th className="th text-right">Amount</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {expenses.map((expense) => (
                  <tr key={expense.id} className="hover:bg-slate-800/30">
                    <td className="td text-slate-400">{formatDate(expense.incurredAt)}</td>
                    <td className="td">{EXPENSE_CATEGORY_LABELS[expense.category]}</td>
                    <td className="td">{expense.description}</td>
                    <td className="td">
                      {expense.purchase ? (
                        <>
                          <Link
                            href={`/items/${expense.purchase.item.id}`}
                            className="text-slate-300 hover:text-emerald-400"
                          >
                            {expense.purchase.item.title}
                          </Link>
                          <span className="block text-xs text-slate-500">
                            {gradeLabel(
                              expense.purchase.grader,
                              expense.purchase.grade,
                              expense.purchase.condition,
                            )}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">General</span>
                      )}
                    </td>
                    <td className="td text-slate-400">{expense.vendor ?? "—"}</td>
                    <td className="td text-right">
                      <MoneyValue money={expenseMoney(expense)} primary={expense.currency} />
                    </td>
                    <td className="td text-right">
                      <DeleteButton
                        action={deleteExpense.bind(null, expense.id)}
                        label="Delete expense"
                        confirmMessage="Delete this expense?"
                        iconOnly
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-800">
                <tr>
                  <td className="td font-medium" colSpan={5}>
                    Total shown
                  </td>
                  <td className="td text-right font-medium">
                    <MoneyValue money={shownTotal} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Add a general expense
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Supplies, subscriptions, table fees, mileage — anything that isn&apos;t attributable
          to a single card or volume.
        </p>
        <ExpenseForm defaultCategory="SUPPLIES" />
      </section>
    </>
  );
}
