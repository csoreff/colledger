import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { itemWithPurchasesSchema } from "@/lib/api/input";
import { upsertItem } from "@/lib/api/records";
import { listParam, page, paging, stringParam, boolParam } from "@/lib/api/query";
import { computeItemRollup } from "@/lib/profit";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/items
 *
 * Filters: q, type, status, grader, source, externalRef.
 * `?rollup=1` adds the computed cost basis, proceeds and realized profit for
 * each card — the same figures the collection page shows, so a script doesn't
 * have to re-derive money rules that live in `src/lib/profit.ts`.
 */
export const GET = apiRoute("READ", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const { limit, offset } = paging(request);
  const withRollup = boolParam(request, "rollup");

  const where: Prisma.ItemWhereInput = { userId };

  const q = stringParam(request, "q");
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { setName: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } },
      { purchases: { some: { certNumber: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const externalRef = stringParam(request, "externalRef");
  if (externalRef) where.externalRef = externalRef;

  const types = listParam(request, "type");
  if (types.length) where.type = { in: types as never };

  // Copy-level filters match a card when any of its copies qualify, matching
  // how the collection page reads.
  const copyFilter: Prisma.PurchaseWhereInput = {};
  const statuses = listParam(request, "status");
  if (statuses.length) copyFilter.status = { in: statuses as never };
  const graders = listParam(request, "grader");
  if (graders.length) copyFilter.grader = { in: graders as never };
  const sources = listParam(request, "source");
  if (sources.length) copyFilter.purchaseSource = { in: sources as never };
  if (Object.keys(copyFilter).length) where.purchases = { some: copyFilter };

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      include: {
        purchases: {
          orderBy: [{ acquiredAt: "asc" }, { id: "asc" }],
          include: withRollup ? { expenses: true, sales: true } : undefined,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.item.count({ where }),
  ]);

  const data = withRollup
    ? items.map((item) => ({
        ...item,
        rollup: computeItemRollup(item as never),
      }))
    : items;

  return apiOk(page(data, total, { limit, offset }));
});

/**
 * POST /api/v1/items
 *
 * Creates a card with its copies. Send an `externalRef` and the call becomes
 * an upsert — re-running the same seed updates rather than duplicating.
 * Accepts a single object or an array.
 */
export const POST = apiRoute("WRITE", async ({ request, principal }) => {
  const body = await jsonBody(request);
  const payloads = Array.isArray(body) ? body : [body];

  if (payloads.length === 0) return apiError("invalid_request", "Send at least one item.");

  const parsed = itemWithPurchasesSchema.array().safeParse(payloads);
  if (!parsed.success) return invalidBody(parsed.error);

  const results = [];
  for (let index = 0; index < parsed.data.length; index += 1) {
    const written = await upsertItem(principal.targetUserId, parsed.data[index]);
    if (!written.ok) {
      return apiError("invalid_request", `items[${index}]: ${written.error}`);
    }
    results.push(written.value);
  }

  const created = results.filter((r) => r.created).length;
  return apiOk(
    {
      items: results,
      summary: { created, updated: results.length - created },
    },
    201,
  );
});
