"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import type { Expense, Purchase, Sale } from "@prisma/client";
import type { PurchaseFinancials } from "@/lib/profit";
import type { Money } from "@/lib/currency";
import {
  formatJpy,
  formatMinor,
  formatPercent,
  formatRate,
  formatUsd,
  isReportingCurrency,
} from "@/lib/currency";
import { formatDate } from "@/lib/dates";
import {
  gradeLabel,
  ITEM_STATUS_LABELS,
  MARKETPLACE_LABELS,
} from "@/lib/labels";
import { Chip } from "@/components/ui";
import { MoneyProfit, MoneyValue } from "@/components/Money";
import { DeleteButton } from "@/components/DeleteButton";
import { ExpenseForm } from "@/components/ExpenseForm";
import { ExpenseRow } from "@/components/ExpenseRow";
import { PurchaseEditForm } from "@/components/ItemForm";
import type { ActionState } from "@/lib/actions";
import { SaleForm } from "@/components/SaleForm";

type SaleSummary = Sale & { net: Money };

function statusTone(status: string) {
  if (status === "SOLD") return "emerald" as const;
  if (status === "LISTED") return "sky" as const;
  if (status === "RETURNED") return "amber" as const;
  if (status === "LOST") return "rose" as const;
  return "slate" as const;
}

/**
 * One purchase row: a collapsed summary line that expands to that copy's own
 * expenses and sale. Collapsed by default so a card with many copies stays
 * scannable.
 */
export function PurchaseCard({
  purchase,
  index,
  fin,
  sales,
  itemType,
  updatePurchase,
  deletePurchase,
  deleteExpense,
  deleteSale,
  defaultOpen,
}: {
  purchase: Purchase & { expenses: Expense[] };
  index: number;
  fin: PurchaseFinancials;
  sales: SaleSummary[];
  itemType: string;
  updatePurchase: (state: ActionState, form: FormData) => Promise<ActionState>;
  deletePurchase: () => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  deleteSale: (id: string) => Promise<void>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            #{index + 1}
          </span>
          <span className="flex flex-col">
            <span className="text-sm text-slate-200">
              {gradeLabel(purchase.grader, purchase.grade, purchase.condition)}
              {purchase.quantity > 1 ? (
                <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
                  ×{purchase.quantity} cards
                </span>
              ) : null}
            </span>
            <span className="text-xs text-slate-500">
              {formatDate(purchase.acquiredAt)} ·{" "}
              {MARKETPLACE_LABELS[purchase.purchaseSource]}
              {/* What actually left your account, visible without expanding. */}
              {!isReportingCurrency(purchase.purchaseCurrency) ? (
                <span className="ml-1 text-slate-400">
                  · paid {formatMinor(purchase.purchaseNativeMinor, purchase.purchaseCurrency)}
                </span>
              ) : null}
            </span>
          </span>
        </button>

        <div className="flex items-center gap-5">
          <span className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wide text-slate-600">Basis</span>
            <MoneyValue money={fin.costBasis} primary={purchase.purchaseCurrency} />
          </span>
          <span className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wide text-slate-600">Profit</span>
            <MoneyProfit money={fin.profit} primary={purchase.purchaseCurrency} />
          </span>
          <Chip tone={statusTone(purchase.status)}>
            {ITEM_STATUS_LABELS[purchase.status as keyof typeof ITEM_STATUS_LABELS]}
          </Chip>
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setOpen(true);
            }}
            className="text-slate-500 hover:text-emerald-400"
            aria-label={`Edit purchase ${index + 1}`}
            title="Edit this purchase"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <DeleteButton
            action={deletePurchase}
            label="Delete purchase"
            confirmMessage={`Delete purchase #${index + 1}? Its expenses and sale go too.`}
            iconOnly
          />
        </div>
      </div>

      {open && editing ? (
        <div className="border-t border-slate-800 p-4">
          <PurchaseEditForm
            action={updatePurchase}
            purchase={purchase}
            itemType={itemType}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}

      {open && !editing ? (
        <div className="space-y-6 border-t border-slate-800 p-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-xs text-slate-500">Paid</dt>
              <dd className="mt-1">
                {/* A GBP/AUD purchase leads with what actually left your
                    account; the reporting pair sits underneath. */}
                {isReportingCurrency(purchase.purchaseCurrency) ? (
                  <MoneyValue
                    money={fin.purchase}
                    primary={purchase.purchaseCurrency}
                    align="left"
                  />
                ) : (
                  <span className="flex flex-col items-start">
                    <span className="tabular-nums leading-tight">
                      {formatMinor(purchase.purchaseNativeMinor, purchase.purchaseCurrency)}
                    </span>
                    <span className="text-xs tabular-nums leading-tight text-slate-500">
                      {formatUsd(fin.purchase.usdCents)} · {formatJpy(fin.purchase.jpyYen)}
                    </span>
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Expenses</dt>
              <dd className="mt-1">
                <MoneyValue money={fin.expenses} align="left" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Cost basis</dt>
              <dd className="mt-1 font-medium">
                <MoneyValue money={fin.costBasis} align="left" />
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

          <p className="text-xs text-slate-500">
            Paid in {purchase.purchaseCurrency}
            {!isReportingCurrency(purchase.purchaseCurrency) &&
            purchase.purchaseFxNativePerUsd
              ? ` at ${purchase.purchaseFxNativePerUsd.toFixed(4)} ${purchase.purchaseCurrency} / $1`
              : ""}
            {purchase.purchaseFxJpyPerUsd
              ? ` · ${formatRate(purchase.purchaseFxJpyPerUsd)}`
              : ""}
            {purchase.certNumber ? ` · cert ${purchase.certNumber}` : ""}
            {purchase.purchaseNotes ? ` — ${purchase.purchaseNotes}` : ""}
          </p>

          {/* --- Expenses for this copy --- */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Expenses for this copy
            </h3>
            {purchase.expenses.length === 0 ? (
              <p className="mb-4 text-sm text-slate-500">
                None yet — grading, inbound shipping, sleeves.
              </p>
            ) : (
              <div className="mb-4 overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <tbody className="divide-y divide-slate-800/70">
                    {purchase.expenses.map((expense) => (
                      <ExpenseRow
                        key={expense.id}
                        expense={expense}
                        deleteAction={deleteExpense.bind(null, expense.id)}
                        showVendor={false}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-slate-800 pt-4">
              <ExpenseForm purchaseId={purchase.id} defaultCategory="GRADING" />
            </div>
          </div>

          {/* --- Sale of this copy --- */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Sale
            </h3>
            {sales.length === 0 ? (
              <p className="mb-4 text-sm text-slate-500">Not sold yet.</p>
            ) : (
              <div className="mb-4 space-y-3">
                {sales.map((sale) => (
                  <div key={sale.id} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-base font-semibold">
                          <MoneyValue
                            money={{
                              usdCents: sale.grossPriceUsdCents,
                              jpyYen: sale.grossPriceJpyYen,
                            }}
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
                        </p>
                        {sale.wasBestOffer && sale.listedPriceUsdCents !== null ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Listed at{" "}
                            {sale.currency === "JPY"
                              ? formatJpy(sale.listedPriceJpyYen)
                              : formatUsd(sale.listedPriceUsdCents)}{" "}
                            — profit uses the accepted offer.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="flex flex-col items-end">
                          <span className="text-[10px] uppercase tracking-wide text-slate-600">
                            Net
                          </span>
                          <MoneyValue money={sale.net} primary={sale.currency} />
                        </span>
                        <DeleteButton
                          action={deleteSale.bind(null, sale.id)}
                          label="Delete sale"
                          confirmMessage="Delete this sale record?"
                          iconOnly
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-slate-800 pt-4">
              <SaleForm purchaseId={purchase.id} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
