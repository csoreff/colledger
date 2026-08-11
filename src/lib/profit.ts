import type { Currency, Expense, Item, Purchase, Sale } from "@prisma/client";
import {
  addMoney,
  amountIn,
  subtractMoney,
  sumMoney,
  ZERO_MONEY,
  type Money,
} from "@/lib/currency";

export type PurchaseWithLedger = Purchase & { expenses: Expense[]; sales: Sale[] };
export type ItemWithPurchases = Item & { purchases: PurchaseWithLedger[] };

/**
 * Every figure is computed in USD and JPY at once. Each underlying record was
 * converted at the rate on its own transaction date, so a copy bought in yen
 * and sold in dollars sums correctly in either currency.
 */
export type PurchaseFinancials = {
  purchase: Money;
  expenses: Money;
  /** purchase + that copy's expenses. Everything sunk into it. */
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

export function purchaseMoney(purchase: Purchase): Money {
  return { usdCents: purchase.purchaseUsdCents, jpyYen: purchase.purchaseJpyYen };
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

export function computePurchaseFinancials(
  purchase: PurchaseWithLedger,
): PurchaseFinancials {
  const purchaseAmount = purchaseMoney(purchase);
  const expenses = sumMoney(purchase.expenses.map(expenseMoney));
  const costBasis = addMoney(purchaseAmount, expenses);

  const grossSales = sumMoney(purchase.sales.map(saleGrossMoney));
  const shippingCollected = sumMoney(purchase.sales.map(saleShippingCollectedMoney));
  const sellingCosts = sumMoney(purchase.sales.map(saleCostsMoney));
  const netProceeds = subtractMoney(addMoney(grossSales, shippingCollected), sellingCosts);

  const isRealized = purchase.sales.length > 0;
  const profit = isRealized ? subtractMoney(netProceeds, costBasis) : null;

  return {
    purchase: purchaseAmount,
    expenses,
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

/** Item-level rollup across every copy you've bought of one card. */
export type ItemRollup = {
  copies: number;
  /** Sum of `quantity` across rows — actual physical count. */
  units: number;
  soldCount: number;
  heldCount: number;

  costBasis: Money;
  /** Cost basis still sitting in unsold copies. */
  inventoryCostBasis: Money;
  netProceeds: Money;
  /** Profit on sold copies only. Null when nothing has sold. */
  realizedProfit: Money | null;
  roi: { usd: number | null; jpy: number | null };
};

export function computeItemRollup(item: ItemWithPurchases): ItemRollup {
  let costBasis = ZERO_MONEY;
  let inventoryCostBasis = ZERO_MONEY;
  let netProceeds = ZERO_MONEY;
  let realizedProfit = ZERO_MONEY;
  let soldCostBasis = ZERO_MONEY;
  let soldCount = 0;
  let heldCount = 0;
  let units = 0;

  for (const purchase of item.purchases) {
    const fin = computePurchaseFinancials(purchase);
    costBasis = addMoney(costBasis, fin.costBasis);
    units += purchase.quantity;

    if (fin.isRealized) {
      soldCount += 1;
      soldCostBasis = addMoney(soldCostBasis, fin.costBasis);
      netProceeds = addMoney(netProceeds, fin.netProceeds);
      realizedProfit = addMoney(realizedProfit, fin.profit ?? ZERO_MONEY);
    } else if (purchase.status !== "LOST") {
      heldCount += 1;
      inventoryCostBasis = addMoney(inventoryCostBasis, fin.costBasis);
    }
  }

  return {
    copies: item.purchases.length,
    units,
    soldCount,
    heldCount,
    costBasis,
    inventoryCostBasis,
    netProceeds,
    realizedProfit: soldCount > 0 ? realizedProfit : null,
    roi: {
      usd: soldCount > 0 ? ratio(realizedProfit.usdCents, soldCostBasis.usdCents) : null,
      jpy: soldCount > 0 ? ratio(realizedProfit.jpyYen, soldCostBasis.jpyYen) : null,
    },
  };
}

export type PortfolioTotals = {
  itemCount: number;
  purchaseCount: number;
  soldCount: number;
  unsoldCount: number;

  totalCostBasis: Money;
  inventoryCostBasis: Money;

  netProceeds: Money;
  /** Profit on sold copies only, before general overhead. */
  grossProfit: Money;
  generalExpenses: Money;
  /** grossProfit - generalExpenses. The real bottom line. */
  netProfit: Money;

  roi: { usd: number | null; jpy: number | null };
};

export function computePortfolioTotals(
  purchases: PurchaseWithLedger[],
  generalExpenses: Expense[],
  itemCount: number,
): PortfolioTotals {
  let totalCostBasis = ZERO_MONEY;
  let inventoryCostBasis = ZERO_MONEY;
  let netProceeds = ZERO_MONEY;
  let grossProfit = ZERO_MONEY;
  let soldCostBasis = ZERO_MONEY;
  let soldCount = 0;

  for (const purchase of purchases) {
    const fin = computePurchaseFinancials(purchase);
    totalCostBasis = addMoney(totalCostBasis, fin.costBasis);

    if (fin.isRealized) {
      soldCount += 1;
      soldCostBasis = addMoney(soldCostBasis, fin.costBasis);
      netProceeds = addMoney(netProceeds, fin.netProceeds);
      grossProfit = addMoney(grossProfit, fin.profit ?? ZERO_MONEY);
    } else if (purchase.status !== "LOST") {
      inventoryCostBasis = addMoney(inventoryCostBasis, fin.costBasis);
    }
  }

  const generalExpenseTotal = sumMoney(generalExpenses.map(expenseMoney));
  const netProfit = subtractMoney(grossProfit, generalExpenseTotal);

  return {
    itemCount,
    purchaseCount: purchases.length,
    soldCount,
    unsoldCount: purchases.length - soldCount,
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
