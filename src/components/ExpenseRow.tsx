"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import type { Expense } from "@prisma/client";
import { formatDate } from "@/lib/dates";
import { EXPENSE_CATEGORY_LABELS, gradeLabel } from "@/lib/labels";
import { MoneyValue } from "@/components/Money";
import { DeleteButton } from "@/components/DeleteButton";
import { ExpenseForm } from "@/components/ExpenseForm";

export type ExpenseRowData = Expense & {
  purchase?: {
    id: string;
    grader: Parameters<typeof gradeLabel>[0];
    grade: string | null;
    condition: string | null;
    item: { id: string; title: string };
  } | null;
};

/**
 * One expense in a table, which expands in place into an edit form.
 *
 * Editing inline rather than on its own page keeps the surrounding list
 * visible, which is what you want when correcting one figure among many.
 */
export function ExpenseRow({
  expense,
  deleteAction,
  showAppliesTo = false,
  showVendor = true,
}: {
  expense: ExpenseRowData;
  deleteAction: () => Promise<void>;
  /** The general/per-copy column, shown only on the all-expenses page. */
  showAppliesTo?: boolean;
  showVendor?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  // date, category, description, [applies to], [vendor], amount, actions
  const columnCount = 4 + (showAppliesTo ? 1 : 0) + (showVendor ? 1 : 0);

  if (editing) {
    return (
      <tr className="bg-slate-900/40">
        <td className="td" colSpan={columnCount}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Editing “{expense.description}”
            {expense.purchase ? ` · ${expense.purchase.item.title}` : " · general expense"}
          </p>
          <ExpenseForm
            expense={expense}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-slate-800/30">
      <td className="td text-slate-400">{formatDate(expense.incurredAt)}</td>
      <td className="td">{EXPENSE_CATEGORY_LABELS[expense.category]}</td>
      <td className="td">{expense.description}</td>

      {showAppliesTo ? (
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
      ) : null}

      {showVendor ? (
        <td className="td text-slate-400">{expense.vendor ?? "—"}</td>
      ) : null}

      <td className="td text-right">
        <MoneyValue
          money={{ usdCents: expense.amountUsdCents, jpyYen: expense.amountJpyYen }}
          primary={expense.currency}
        />
      </td>

      <td className="td">
        <span className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-slate-500 hover:text-emerald-400"
            aria-label={`Edit ${expense.description}`}
            title="Edit this expense"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <DeleteButton
            action={deleteAction}
            label="Delete expense"
            confirmMessage={`Delete "${expense.description}"?`}
            iconOnly
          />
        </span>
      </td>
    </tr>
  );
}
