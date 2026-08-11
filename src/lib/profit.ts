import type { Currency, Expense, Item, Sale } from "@prisma/client";
import {
  addMoney,
  amountIn,
  subtractMoney,
  sumMoney,
  ZERO_MONEY,
  type Money,
} from "@/lib/currency";

export type ItemWithLedger = Item & { expenses: Expense[]; sales: Sale[] };

/**
 * Every figure is computed in USD and JPY at once. Each underlying record was
 * converted at the rate on its own transaction date, so a card bought in yen
 * and sold in dollars sums correctly in either currency.
 */
export type ItemFinancials = {
  purchase: Money;
  itemExpenses: Money;
  /** purchase + item expenses. Everything sunk into the item. */
  costBasis: Money;

  grossSales: Money;
  shippingCollected: Money;
  sellingCosts: Money;
  /** What actually landed in your pocket from the sale(s). */
  netProceeds: Money;

  isRealized: boolean;
  /** netProceeds - costBasis. Null while unsold. */
  profit: Money | null;
  /** ROI per currency; they differ when the rate moved between buy and sell. */
  roi: { usd: number | null; jpy: number | null };
};

export function expenseMoney(expense: Expense): Money {
  return { usdCents: expense.amountUsdCents, jpyYen: expense.amountJpyYen };
}

export function purchaseMoney(item: Item): Money {
  return { usdCents: item.purchaseUsdCents, jpyYen: item.purchaseJpyYen };
}

export function saleGrossMoney(sale: Sale): Money {
  return { usdCents: sale.grossPriceUsdCents, jpyYen: sale.grossPriceJpyYen };
}

export function saleShippingCollectedMoney(sale: Sale): Money {
  return {
    usdCents: sale.shippingCollectedUsdCents,
    jpyYen: sale.shippingCollectedJpyYen,
  };
}

export function saleCostsMoney(sale: Sale): Money {
  return {
    usdCents: sale.platformFeeUsdCents + sale.shippingCostUsdCents + sale.otherFeeUsdCents,
    jpyYen: sale.platformFeeJpyYen + sale.shippingCostJpyYen + sale.otherFeeJpyYen,
  };
}

export function saleNetMoney(sale: Sale): Money {
  return subtractMoney(
    addMoney(saleGrossMoney(sale), saleShippingCollectedMoney(sale)),
    saleCostsMoney(sale),
  );
}

function ratio(profit: number, basis: number): number | null {
  return basis > 0 ? profit / basis : null;
}

export function computeItemFinancials(item: ItemWithLedger): ItemFinancials {
  const purchase = purchaseMoney(item);
  const itemExpenses = sumMoney(item.expenses.map(expenseMoney));
  const costBasis = addMoney(purchase, itemExpenses);

  const grossSales = sumMoney(item.sales.map(saleGrossMoney));
  const shippingCollected = sumMoney(item.sales.map(saleShippingCollectedMoney));
  const sellingCosts = sumMoney(item.sales.map(saleCostsMoney));
  const netProceeds = subtractMoney(addMoney(grossSales, shippingCollected), sellingCosts);

  const isRealized = item.sales.length > 0;
  const profit = isRealized ? subtractMoney(netProceeds, costBasis) : null;

  return {
    purchase,
    itemExpenses,
    costBasis,
    grossSales,
    shippingCollected,
    sellingCosts,
    netProceeds,
    isRealized,
    profit,
    roi: {
      usd: profit ? ratio(profit.usdCents, costBasis.usdCents) : null,
      jpy: profit ? ratio(profit.jpyYen, costBasis.jpyYen) : null,
    },
  };
}

export type PortfolioTotals = {
  itemCount: number;
  soldCount: number;
  unsoldCount: number;

  totalCostBasis: Money;
  inventoryCostBasis: Money;

  netProceeds: Money;
  /** Profit on sold items only, before general overhead. */
  grossProfit: Money;
  generalExpenses: Money;
  /** grossProfit - generalExpenses. The real bottom line. */
  netProfit: Money;

  roi: { usd: number | null; jpy: number | null };
};

export function computePortfolioTotals(
  items: ItemWithLedger[],
  generalExpenses: Expense[],
): PortfolioTotals {
  let totalCostBasis = ZERO_MONEY;
  let inventoryCostBasis = ZERO_MONEY;
  let netProceeds = ZERO_MONEY;
  let grossProfit = ZERO_MONEY;
  let soldCostBasis = ZERO_MONEY;
  let soldCount = 0;

  for (const item of items) {
    const fin = computeItemFinancials(item);
    totalCostBasis = addMoney(totalCostBasis, fin.costBasis);

    if (fin.isRealized) {
      soldCount += 1;
      soldCostBasis = addMoney(soldCostBasis, fin.costBasis);
      netProceeds = addMoney(netProceeds, fin.netProceeds);
      grossProfit = addMoney(grossProfit, fin.profit ?? ZERO_MONEY);
    } else if (item.status !== "LOST") {
      inventoryCostBasis = addMoney(inventoryCostBasis, fin.costBasis);
    }
  }

  const generalExpenseTotal = sumMoney(generalExpenses.map(expenseMoney));
  const netProfit = subtractMoney(grossProfit, generalExpenseTotal);

  return {
    itemCount: items.length,
    soldCount,
    unsoldCount: items.length - soldCount,
    totalCostBasis,
    inventoryCostBasis,
    netProceeds,
    grossProfit,
    generalExpenses: generalExpenseTotal,
    netProfit,
    roi: {
      usd: ratio(netProfit.usdCents, soldCostBasis.usdCents),
      jpy: ratio(netProfit.jpyYen, soldCostBasis.jpyYen),
    },
  };
}

/** ROI in the currently displayed currency. */
export function roiIn(
  roi: { usd: number | null; jpy: number | null },
  currency: Currency,
): number | null {
  return currency === "JPY" ? roi.jpy : roi.usd;
}

export { amountIn };
