"use client";

import { useId, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Currency, Grader, Purchase } from "@prisma/client";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  isReportingCurrency,
  minorToInputValue,
  toInputValue,
} from "@/lib/currency";
import { todayInputValue, toDateInputValue } from "@/lib/dates";
import {
  defaultCurrencyFor,
  gradeOptionsFor,
  GRADER_LABELS,
  GRADERS,
  ITEM_STATUS_LABELS,
  ITEM_STATUSES,
  MARKETPLACE_LABELS,
  MARKETPLACES,
  maxGradeLabel,
} from "@/lib/labels";
import { Field } from "@/components/ui";
import { FxRateNotice, FxRateProvider, MoneyInput } from "@/components/MoneyInput";

/**
 * One row's worth of local state. `key` namespaces every input name as
 * `p<key>_<field>`, which is what lets a row keep its identity across renders
 * even when fields are conditionally shown or a middle row is removed.
 */
type Row = {
  key: string;
  /** Set only for rows that already exist in the database. */
  existingId?: string;
  acquiredAt: string;
  source: string;
  currency: Currency;
  grader: Grader;
  status: string;
  defaultUsd: string;
  defaultJpy: string;
  defaultNative: string;
  defaultGrade: string;
  defaultCert: string;
  defaultCondition: string;
  defaultQuantity: number;
  defaultNotes: string;
};

/**
 * Row keys must be identical on the server and in the browser, or hydration
 * leaves the two disagreeing about input names and fields silently fail to
 * submit. So initial rows are keyed by position, and only rows added after
 * mount — which never render on the server — use a counter, held per component
 * instance rather than at module scope.
 */
function initialKey(prefix: string, index: number): string {
  return `${prefix}i${index}`;
}

function blankRow(key: string): Row {
  return {
    key,
    acquiredAt: todayInputValue(),
    source: "EBAY",
    currency: defaultCurrencyFor("EBAY"),
    grader: "RAW",
    status: "OWNED",
    defaultUsd: "",
    defaultJpy: "",
    defaultNative: "",
    defaultGrade: "",
    defaultCert: "",
    defaultCondition: "",
    defaultQuantity: 1,
    defaultNotes: "",
  };
}

function rowFromPurchase(purchase: Purchase, key: string): Row {
  const money = {
    usdCents: purchase.purchaseUsdCents,
    jpyYen: purchase.purchaseJpyYen,
  };
  return {
    key,
    existingId: purchase.id,
    acquiredAt: toDateInputValue(purchase.acquiredAt),
    source: purchase.purchaseSource,
    currency: purchase.purchaseCurrency,
    grader: purchase.grader,
    status: purchase.status,
    defaultUsd: toInputValue(money, "USD"),
    defaultJpy: toInputValue(money, "JPY"),
    defaultNative: isReportingCurrency(purchase.purchaseCurrency)
      ? ""
      : minorToInputValue(purchase.purchaseNativeMinor, purchase.purchaseCurrency),
    defaultGrade: purchase.grade ?? "",
    defaultCert: purchase.certNumber ?? "",
    defaultCondition: purchase.condition ?? "",
    defaultQuantity: purchase.quantity,
    defaultNotes: purchase.purchaseNotes ?? "",
  };
}

/**
 * The repeatable purchases table. Each row is an independent acquisition with
 * its own date, price, currency, grading and status — so one card can hold a
 * PSA 10 bought in yen last year and a raw copy bought in dollars last week.
 */
export function PurchaseRows({
  purchases,
  itemType,
  minRows = 1,
  heading = "Purchases",
  description,
  allowAdd = true,
  bare = false,
}: {
  purchases?: Purchase[];
  itemType: string;
  /** Set to 0 when the section is optional (the standalone "add a copy" form). */
  minRows?: number;
  heading?: string;
  description?: string;
  /** Hidden when editing one existing row, where adding makes no sense. */
  allowAdd?: boolean;
  /** Drops the card chrome and per-row header, for use inside a framed panel. */
  bare?: boolean;
}) {
  const prefix = useId().replace(/[^A-Za-z0-9]/g, "");
  const addedCount = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    purchases && purchases.length > 0
      ? purchases.map((p, index) => rowFromPurchase(p, initialKey(prefix, index)))
      : [blankRow(initialKey(prefix, 0))],
  );

  const appendRow = () => {
    addedCount.current += 1;
    setRows((current) => [...current, blankRow(`${prefix}n${addedCount.current}`)]);
  };

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  return (
    <section className={bare ? "space-y-4" : "card space-y-4"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {heading}
          </h2>
          {description === "" ? null : (
            <p className="mt-1 text-xs text-slate-500">
              {description ??
                "One row per copy you bought. Each keeps its own price, date, condition and status."}
            </p>
          )}
        </div>
        {allowAdd ? (
          <button type="button" onClick={appendRow} className="btn-secondary">
            <Plus className="h-4 w-4" />
            Add another purchase
          </button>
        ) : null}
      </div>

      <div className="space-y-4">
        {rows.map((row, index) => {
          const field = (name: string) => `p${row.key}_${name}`;
          const isGraded = row.grader !== "RAW";
          const maxGrade = maxGradeLabel(row.grader);

          return (
            <div
              key={row.key}
              className={bare ? "" : "rounded-lg border border-slate-800 bg-slate-950/40 p-4"}
            >
              <div
                className={`mb-3 items-center justify-between ${bare ? "hidden" : "flex"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Purchase {index + 1}
                  </span>
                  {!isReportingCurrency(row.currency) ? (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">
                      {row.currency}
                    </span>
                  ) : null}
                </span>
                {rows.length > minRows ? (
                  <button
                    type="button"
                    onClick={() =>
                      setRows((current) => current.filter((r) => r.key !== row.key))
                    }
                    className="text-slate-600 hover:text-rose-400"
                    aria-label={`Remove purchase ${index + 1}`}
                    title="Remove this purchase"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

              {row.existingId ? (
                <input type="hidden" name={field("id")} value={row.existingId} />
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Field label="Purchase date">
                  <input
                    name={field("acquiredAt")}
                    type="date"
                    required
                    value={row.acquiredAt}
                    onChange={(e) => update(row.key, { acquiredAt: e.target.value })}
                    className="input"
                  />
                </Field>

                <Field label="Bought from">
                  <select
                    name={field("purchaseSource")}
                    value={row.source}
                    onChange={(e) =>
                      update(row.key, {
                        source: e.target.value,
                        currency: defaultCurrencyFor(e.target.value as never),
                      })
                    }
                    className="input"
                  >
                    {MARKETPLACES.map((m) => (
                      <option key={m} value={m}>
                        {MARKETPLACE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Paid in">
                  <select
                    name={field("purchaseCurrency")}
                    value={row.currency}
                    onChange={(e) =>
                      update(row.key, { currency: e.target.value as Currency })
                    }
                    className="input"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {CURRENCY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Status">
                  <select
                    name={field("status")}
                    value={row.status}
                    onChange={(e) => update(row.key, { status: e.target.value })}
                    className="input"
                  >
                    {ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {ITEM_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="mt-4">
                <FxRateProvider date={row.acquiredAt} currency={row.currency}>
                  <MoneyInput
                    name={field("purchase")}
                    label="Price paid"
                    required
                    currency={row.currency}
                    defaultUsd={row.defaultUsd}
                    defaultJpy={row.defaultJpy}
                    defaultNative={row.defaultNative}
                    hint="The total for this row, not per card."
                  />
                  <div className="mt-1">
                    <FxRateNotice date={row.acquiredAt} currency={row.currency} />
                  </div>
                </FxRateProvider>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Field label="Graded by">
                  <select
                    name={field("grader")}
                    value={row.grader}
                    onChange={(e) =>
                      update(row.key, { grader: e.target.value as Grader })
                    }
                    className="input"
                  >
                    {GRADERS.map((g) => (
                      <option key={g} value={g}>
                        {GRADER_LABELS[g]}
                      </option>
                    ))}
                  </select>
                </Field>

                {isGraded ? (
                  <>
                    <Field
                      label="Grade"
                      hint={maxGrade ? `Up to ${maxGrade}.` : undefined}
                    >
                      <input
                        name={field("grade")}
                        defaultValue={row.defaultGrade}
                        placeholder={maxGrade ?? "10"}
                        className="input"
                        list={`grades-${row.key}`}
                      />
                      <datalist id={`grades-${row.key}`}>
                        {gradeOptionsFor(row.grader).map((g) => (
                          <option key={g} value={g} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label="Cert number">
                      <input
                        name={field("certNumber")}
                        defaultValue={row.defaultCert}
                        className="input"
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Condition" hint="e.g. NM, LP, Like New">
                    <input
                      name={field("condition")}
                      defaultValue={row.defaultCondition}
                      placeholder={itemType === "MANGA" ? "Like New" : "NM"}
                      className="input"
                    />
                  </Field>
                )}

                <Field label="Quantity" hint="Copies in this one purchase.">
                  <input
                    name={field("quantity")}
                    type="number"
                    min={1}
                    defaultValue={row.defaultQuantity}
                    className="input"
                  />
                </Field>
              </div>

              <div className="mt-4">
                <Field label="Notes for this purchase">
                  <input
                    name={field("purchaseNotes")}
                    defaultValue={row.defaultNotes}
                    className="input"
                  />
                </Field>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
