import { prisma } from "@/lib/prisma";
import { apiOk, apiRoute } from "@/lib/api/http";
import { computePortfolioTotals } from "@/lib/profit";

export const dynamic = "force-dynamic";

/**
 * The dashboard's figures, as JSON.
 *
 * Computed through the same `computePortfolioTotals` the web page uses rather
 * than re-summed here, so the API and the UI can never disagree about what
 * profit is — the dual-currency and cost-basis rules live in one place.
 */
export const GET = apiRoute("READ", async ({ principal }) => {
  const userId = principal.targetUserId;

  const [purchases, generalExpenses, itemCount, expenseByCategory] = await Promise.all([
    prisma.purchase.findMany({
      where: { userId },
      include: { expenses: true, sales: true },
    }),
    prisma.expense.findMany({ where: { userId, purchaseId: null } }),
    prisma.item.count({ where: { userId } }),
    prisma.expense.groupBy({
      by: ["category"],
      where: { userId },
      _sum: { amountUsdCents: true, amountJpyYen: true },
      orderBy: { _sum: { amountUsdCents: "desc" } },
    }),
  ]);

  const totals = computePortfolioTotals(purchases, generalExpenses, itemCount);

  return apiOk({
    totals,
    expensesByCategory: expenseByCategory.map((group) => ({
      category: group.category,
      usdCents: group._sum.amountUsdCents ?? 0,
      jpyYen: group._sum.amountJpyYen ?? 0,
    })),
    counts: {
      items: itemCount,
      purchases: purchases.length,
      sales: purchases.reduce((sum, p) => sum + p.sales.length, 0),
    },
  });
});
