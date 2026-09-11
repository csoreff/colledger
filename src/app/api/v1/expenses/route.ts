import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { expenseSchema } from "@/lib/api/input";
import { buildExpenseData } from "@/lib/api/records";
import { listParam, page, paging, stringParam } from "@/lib/api/query";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/expenses
 *
 * `?scope=general` for overhead not tied to a copy, `?scope=item` for the rest,
 * omitted for both.
 */
export const GET = apiRoute("READ", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const { limit, offset } = paging(request);

  const where: Prisma.ExpenseWhereInput = { userId };

  const scope = stringParam(request, "scope");
  if (scope === "general") where.purchaseId = null;
  if (scope === "item") where.NOT = { purchaseId: null };

  const purchaseId = stringParam(request, "purchaseId");
  if (purchaseId) where.purchaseId = purchaseId;
  const externalRef = stringParam(request, "externalRef");
  if (externalRef) where.externalRef = externalRef;

  const categories = listParam(request, "category");
  if (categories.length) where.category = { in: categories as never };

  const since = stringParam(request, "since");
  const until = stringParam(request, "until");
  if (since || until) {
    where.incurredAt = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lte: new Date(until) } : {}),
    };
  }

  const [expenses, total, totals] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { incurredAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({
      where,
      _sum: { amountUsdCents: true, amountJpyYen: true },
    }),
  ]);

  return apiOk({
    ...page(expenses, total, { limit, offset }),
    // Summed over the whole filtered set, not just this page — a running total
    // that changed as you paged would be useless.
    totals: {
      usdCents: totals._sum.amountUsdCents ?? 0,
      jpyYen: totals._sum.amountJpyYen ?? 0,
    },
  });
});

/** POST /api/v1/expenses — one expense or an array of them. */
export const POST = apiRoute("WRITE", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const body = await jsonBody(request);
  const payloads = Array.isArray(body) ? body : [body];

  const parsed = expenseSchema.array().safeParse(payloads);
  if (!parsed.success) return invalidBody(parsed.error);

  const results = [];
  for (let index = 0; index < parsed.data.length; index += 1) {
    const built = await buildExpenseData(userId, parsed.data[index], `expenses[${index}]`);
    if (!built.ok) return apiError("invalid_request", built.error);

    const { externalRef, ...fields } = built.value;
    const existing = externalRef
      ? await prisma.expense.findUnique({
          where: { userId_externalRef: { userId, externalRef } },
          select: { id: true },
        })
      : null;

    if (existing) {
      await prisma.expense.updateMany({ where: { id: existing.id, userId }, data: fields });
      results.push({ id: existing.id, created: false });
    } else {
      const row = await prisma.expense.create({
        data: { ...fields, externalRef },
        select: { id: true },
      });
      results.push({ id: row.id, created: true });
    }
  }

  return apiOk({ expenses: results }, 201);
});
