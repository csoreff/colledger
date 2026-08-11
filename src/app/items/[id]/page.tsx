import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { deleteExpense, deleteItem, deleteSale } from "@/lib/actions";
import {
  computeItemFinancials,
  expenseMoney,
  saleGrossMoney,
  saleNetMoney,
} from "@/lib/profit";
import { formatPercent, formatRate } from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import {
  EXPENSE_CATEGORY_LABELS,
  gradeLabel,
  ITEM_STATUS_LABELS,
  ITEM_TYPE_LABELS,
  MARKETPLACE_LABELS,
} from "@/lib/labels";
import { Chip, PageHeader } from "@/components/ui";
import { MoneyProfit, MoneyValue } from "@/components/Money";
import { DeleteButton } from "@/components/DeleteButton";
import { ExpenseForm } from "@/components/ExpenseForm";
import { SaleForm } from "@/components/SaleForm";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: { id: string } }) {
  const item = await prisma.item.findUnique({
    where: { id: params.id },
    include: {
      expenses: { orderBy: { incurredAt: "desc" } },
      sales: { orderBy: { soldAt: "desc" } },
    },
  });
  if (!item) notFound();

  const fin = computeItemFinancials(item);

  const compsHref = `/comps?${new URLSearchParams({
    q: item.compQuery || [item.setName, item.title, item.number].filter(Boolean).join(" "),
    itemType: item.type,
    grader: item.grader,
    ...(item.grade ? { grade: item.grade } : {}),
  })}`;

  return (
    <>
      <PageHeader
        title={item.title}
        subtitle={[
          ITEM_TYPE_LABELS[item.type],
          item.setName,
          item.number ? `#${item.number}` : null,
          item.variant,
          gradeLabel(item.grader, item.grade, item.condition),
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={compsHref} className="btn-secondary">
              <Search className="h-4 w-4" />
              Look up comps
            </Link>
            <Link href={`/items/${item.id}/edit`} className="btn-secondary">
              Edit
            </Link>
            <DeleteButton
              action={deleteItem.bind(null, item.id)}
              label="Delete item"
              confirmMessage={`Delete "${item.title}"? Its expenses and sales are deleted too.`}
            />
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Chip tone={item.status === "SOLD" ? "emerald" : "slate"}>
          {ITEM_STATUS_LABELS[item.status]}
        </Chip>
        {item.certNumber ? <Chip>Cert {item.certNumber}</Chip> : null}
        <Chip>{item.language}</Chip>
        {item.quantity > 1 ? <Chip>Qty {item.quantity}</Chip> : null}
      </div>

      {/* --- Money summary --- */}
      <section className="card mb-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          The numbers
        </h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-xs text-slate-500">Paid</dt>
            <dd className="mt-1">
              <MoneyValue money={fin.purchase} primary={item.purchaseCurrency} align="left" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Expenses</dt>
            <dd className="mt-1">
              <MoneyValue money={fin.itemExpenses} align="left" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Cost basis</dt>
            <dd className="mt-1 font-medium">
              <MoneyValue money={fin.costBasis} align="left" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Gross sale</dt>
            <dd className="mt-1">
              {fin.isRealized ? (
                <MoneyValue
                  money={{
                    usdCents: fin.grossSales.usdCents + fin.shippingCollected.usdCents,
                    jpyYen: fin.grossSales.jpyYen + fin.shippingCollected.jpyYen,
                  }}
                  align="left"
                />
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Net proceeds</dt>
            <dd className="mt-1">
              {fin.isRealized ? (
                <MoneyValue money={fin.netProceeds} align="left" />
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Profit</dt>
            <dd className="mt-1">
              <MoneyProfit money={fin.profit} align="left" />
              {fin.roi.usd !== null ? (
                <span className="text-xs text-slate-500">
                  {formatPercent(fin.roi.usd)} USD · {formatPercent(fin.roi.jpy)} JPY
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          Bought {formatDate(item.acquiredAt)} from {MARKETPLACE_LABELS[item.purchaseSource]}
          {" · paid in "}
          {item.purchaseCurrency}
          {item.purchaseFxJpyPerUsd
            ? ` at ${formatRate(item.purchaseFxJpyPerUsd)}`
            : ""}
          {item.purchaseNotes ? ` — ${item.purchaseNotes}` : ""}
        </p>
      </section>

      {item.notes ? (
        <section className="card mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Notes
          </h2>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{item.notes}</p>
        </section>
      ) : null}

      {/* --- Expenses --- */}
      <section className="card mb-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Expenses for this item
        </h2>

        {item.expenses.length === 0 ? (
          <p className="mb-6 text-sm text-slate-500">
            No expenses yet. Grading, shipping in, sleeves — add as many as you need.
          </p>
        ) : (
          <div className="mb-6 overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Category</th>
                  <th className="th">Description</th>
                  <th className="th">Vendor</th>
                  <th className="th text-right">Amount</th>
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {item.expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td className="td text-slate-400">{formatDate(expense.incurredAt)}</td>
                    <td className="td">{EXPENSE_CATEGORY_LABELS[expense.category]}</td>
                    <td className="td">{expense.description}</td>
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
                  <td className="td font-medium" colSpan={4}>
                    Total
                  </td>
                  <td className="td text-right font-medium">
                    <MoneyValue money={fin.itemExpenses} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="border-t border-slate-800 pt-5">
          <ExpenseForm itemId={item.id} defaultCategory="GRADING" />
        </div>
      </section>

      {/* --- Sales --- */}
      <section className="card">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Sales
        </h2>

        {item.sales.length === 0 ? (
          <p className="mb-6 text-sm text-slate-500">Not sold yet.</p>
        ) : (
          <div className="mb-6 space-y-4">
            {item.sales.map((sale) => {
              const net = saleNetMoney(sale);
              return (
                <div key={sale.id} className="rounded-lg border border-slate-800 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-lg font-semibold">
                        <MoneyValue
                          money={saleGrossMoney(sale)}
                          primary={sale.currency}
                          align="left"
                        />
                        {sale.wasBestOffer ? (
                          <Chip tone="amber">Best Offer accepted</Chip>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">
                        {formatDate(sale.soldAt)} on {MARKETPLACE_LABELS[sale.platform]}
                        {` · settled in ${sale.currency}`}
                        {sale.fxJpyPerUsd ? ` at ${formatRate(sale.fxJpyPerUsd)}` : ""}
                        {sale.buyer ? ` · ${sale.buyer}` : ""}
                      </p>
                      {sale.wasBestOffer && sale.listedPriceUsdCents !== null ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Was listed at{" "}
                          {sale.currency === "JPY"
                            ? `¥${(sale.listedPriceJpyYen ?? 0).toLocaleString()}`
                            : `$${((sale.listedPriceUsdCents ?? 0) / 100).toFixed(2)}`}{" "}
                          — profit uses the accepted offer, not the asking price.
                        </p>
                      ) : null}
                    </div>
                    <DeleteButton
                      action={deleteSale.bind(null, sale.id)}
                      label="Delete sale"
                      confirmMessage="Delete this sale record?"
                      iconOnly
                    />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                    <div>
                      <dt className="text-xs text-slate-500">Shipping in</dt>
                      <dd>
                        <MoneyValue
                          money={{
                            usdCents: sale.shippingCollectedUsdCents,
                            jpyYen: sale.shippingCollectedJpyYen,
                          }}
                          primary={sale.currency}
                          align="left"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Platform fees</dt>
                      <dd className="text-rose-400">
                        <MoneyValue
                          money={{
                            usdCents: -sale.platformFeeUsdCents,
                            jpyYen: -sale.platformFeeJpyYen,
                          }}
                          primary={sale.currency}
                          align="left"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Postage</dt>
                      <dd className="text-rose-400">
                        <MoneyValue
                          money={{
                            usdCents: -sale.shippingCostUsdCents,
                            jpyYen: -sale.shippingCostJpyYen,
                          }}
                          primary={sale.currency}
                          align="left"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Other fees</dt>
                      <dd className="text-rose-400">
                        <MoneyValue
                          money={{
                            usdCents: -sale.otherFeeUsdCents,
                            jpyYen: -sale.otherFeeJpyYen,
                          }}
                          primary={sale.currency}
                          align="left"
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Net</dt>
                      <dd className="font-medium">
                        <MoneyValue money={net} primary={sale.currency} align="left" />
                      </dd>
                    </div>
                  </dl>

                  {sale.notes ? (
                    <p className="mt-3 text-sm text-slate-400">{sale.notes}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-slate-800 pt-5">
          <SaleForm itemId={item.id} />
        </div>
      </section>

      {item.imageUrl ? (
        <a
          href={item.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-emerald-400"
        >
          View image <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </>
  );
}
