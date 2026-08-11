import type { Expense, Item, Sale } from "@prisma/client";

export type ItemWithLedger = Item & { expenses: Expense[]; sales: Sale[] };

export type ItemFinancials = {
  /** What was paid for the item itself. */
  purchaseCents: number;
  /** Expenses attributed to this item (grading, inbound shipping, ...). */
  itemExpenseCents: number;
  /** purchase + item expenses. Everything sunk into the item. */
  costBasisCents: number;

  /** Item price(s) the buyer paid, excluding shipping they were charged. */
  grossSalesCents: number;
  /** Shipping revenue collected from buyers. */
  shippingCollectedCents: number;
  /** Fees + outbound postage deducted from the sale. */
  sellingCostCents: number;
  /** What actually landed in your pocket from the sale(s). */
  netProceedsCents: number;

  /** True once at least one sale is recorded. */
  isRealized: boolean;
  /** netProceeds - costBasis. Null while unsold. */
  profitCents: number | null;
  /** profit / costBasis. Null while unsold or when basis is zero. */
  roi: number | null;
};

export function computeItemFinancials(item: ItemWithLedger): ItemFinancials {
  const purchaseCents = item.purchasePriceCents;
  const itemExpenseCents = item.expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const costBasisCents = purchaseCents + itemExpenseCents;

  const grossSalesCents = item.sales.reduce((sum, s) => sum + s.grossPriceCents, 0);
  const shippingCollectedCents = item.sales.reduce(
    (sum, s) => sum + s.shippingCollectedCents,
    0,
  );
  const sellingCostCents = item.sales.reduce(
    (sum, s) => sum + s.platformFeeCents + s.shippingCostCents + s.otherFeeCents,
    0,
  );
  const netProceedsCents = grossSalesCents + shippingCollectedCents - sellingCostCents;

  const isRealized = item.sales.length > 0;
  const profitCents = isRealized ? netProceedsCents - costBasisCents : null;
  const roi =
    profitCents !== null && costBasisCents > 0 ? profitCents / costBasisCents : null;

  return {
    purchaseCents,
    itemExpenseCents,
    costBasisCents,
    grossSalesCents,
    shippingCollectedCents,
    sellingCostCents,
    netProceedsCents,
    isRealized,
    profitCents,
    roi,
  };
}

export type PortfolioTotals = {
  itemCount: number;
  soldCount: number;
  unsoldCount: number;

  /** Cost basis of every item ever bought, sold or not. */
  totalCostBasisCents: number;
  /** Cost basis still sitting in unsold inventory. */
  inventoryCostBasisCents: number;

  netProceedsCents: number;
  /** Profit on sold items only, before general overhead. */
  grossProfitCents: number;
  /** Overhead not tied to any one item. */
  generalExpenseCents: number;
  /** grossProfit - generalExpenses. The real bottom line. */
  netProfitCents: number;

  roi: number | null;
};

export function computePortfolioTotals(
  items: ItemWithLedger[],
  generalExpenses: Expense[],
): PortfolioTotals {
  let totalCostBasisCents = 0;
  let inventoryCostBasisCents = 0;
  let netProceedsCents = 0;
  let grossProfitCents = 0;
  let soldCostBasisCents = 0;
  let soldCount = 0;

  for (const item of items) {
    const fin = computeItemFinancials(item);
    totalCostBasisCents += fin.costBasisCents;

    if (fin.isRealized) {
      soldCount += 1;
      soldCostBasisCents += fin.costBasisCents;
      netProceedsCents += fin.netProceedsCents;
      grossProfitCents += fin.profitCents ?? 0;
    } else if (item.status !== "LOST") {
      inventoryCostBasisCents += fin.costBasisCents;
    }
  }

  const generalExpenseCents = generalExpenses.reduce((sum, e) => sum + e.amountCents, 0);
  const netProfitCents = grossProfitCents - generalExpenseCents;

  return {
    itemCount: items.length,
    soldCount,
    unsoldCount: items.length - soldCount,
    totalCostBasisCents,
    inventoryCostBasisCents,
    netProceedsCents,
    grossProfitCents,
    generalExpenseCents,
    netProfitCents,
    roi: soldCostBasisCents > 0 ? netProfitCents / soldCostBasisCents : null,
  };
}
