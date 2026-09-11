import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { expenseSchema, itemWithPurchasesSchema, saleSchema } from "@/lib/api/input";
import {
  buildExpenseData,
  buildSaleData,
  upsertItem,
  upsertSaleRow,
} from "@/lib/api/records";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/import — seed or refresh a whole ledger in one call.
 *
 * Ordering matters and is fixed here rather than left to the caller: items (and
 * the copies nested under them) first, because expenses and sales reference a
 * copy by `purchaseRef`, and that ref has to exist before anything can point at
 * it. A single payload can therefore describe a collection from nothing.
 *
 * Everything keyed by `externalRef` upserts, so the same file can be pushed
 * repeatedly — the usual shape of a sync job — without duplicating rows.
 */
const importSchema = z.object({
  items: z.array(itemWithPurchasesSchema).default([]),
  expenses: z.array(expenseSchema).default([]),
  sales: z.array(saleSchema).default([]),
  /**
   * Validate and report without writing anything. Worth running first against
   * a real ledger: it surfaces unconvertible amounts and unknown refs before
   * any of them land.
   */
  dryRun: z.boolean().default(false),
});

export const POST = apiRoute("WRITE", async ({ request, principal }) => {
  const userId = principal.targetUserId;

  const parsed = importSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return invalidBody(parsed.error);

  const { items, expenses, sales, dryRun } = parsed.data;

  if (dryRun) {
    // A dry run can only check what doesn't depend on writes: shapes parsed
    // above, plus whether every named copy already exists. Refs created by
    // this same payload are reported as "would be created" rather than errors.
    const willExist = new Set<string>();
    for (const item of items) {
      for (const purchase of item.purchases) {
        if (purchase.externalRef) willExist.add(purchase.externalRef);
      }
    }

    const problems: string[] = [];
    const referencing = [...expenses, ...sales];
    for (let index = 0; index < referencing.length; index += 1) {
      const row = referencing[index];
      const ref = row.purchaseRef?.trim();
      const id = row.purchaseId?.trim();
      if (!ref && !id) continue;
      if (ref && willExist.has(ref)) continue;

      const found = await prisma.purchase.findFirst({
        where: { userId, ...(id ? { id } : { externalRef: ref }) },
        select: { id: true },
      });
      if (!found) {
        problems.push(`row ${index}: no purchase matching ${id ?? ref}.`);
      }
    }

    return apiOk({
      dryRun: true,
      wouldWrite: { items: items.length, expenses: expenses.length, sales: sales.length },
      problems,
      ok: problems.length === 0,
    });
  }

  const summary = {
    items: { created: 0, updated: 0 },
    purchases: { created: 0, updated: 0 },
    expenses: { created: 0, updated: 0 },
    sales: { created: 0, updated: 0 },
  };

  for (let index = 0; index < items.length; index += 1) {
    const written = await upsertItem(userId, items[index]);
    if (!written.ok) return apiError("invalid_request", `items[${index}]: ${written.error}`);

    if (written.value.created) summary.items.created += 1;
    else summary.items.updated += 1;
    summary.purchases.created += written.value.purchasesCreated;
    summary.purchases.updated += written.value.purchasesUpdated;
  }

  for (let index = 0; index < expenses.length; index += 1) {
    const built = await buildExpenseData(userId, expenses[index], `expenses[${index}]`);
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
      summary.expenses.updated += 1;
    } else {
      await prisma.expense.create({ data: { ...fields, externalRef } });
      summary.expenses.created += 1;
    }
  }

  for (let index = 0; index < sales.length; index += 1) {
    const built = await buildSaleData(userId, sales[index], `sales[${index}]`);
    if (!built.ok) return apiError("invalid_request", built.error);

    const externalRef = built.value.externalRef;
    const existing = externalRef
      ? await prisma.sale.findUnique({
          where: { userId_externalRef: { userId, externalRef } },
          select: { id: true },
        })
      : null;

    const written = await upsertSaleRow(userId, existing?.id ?? null, built.value);
    if (written.created) summary.sales.created += 1;
    else summary.sales.updated += 1;
  }

  return apiOk({ imported: summary, userId });
});
