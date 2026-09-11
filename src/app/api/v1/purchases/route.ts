import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { purchaseSchema } from "@/lib/api/input";
import { buildPurchaseData } from "@/lib/api/records";
import { listParam, page, paging, stringParam, boolParam } from "@/lib/api/query";
import { computePurchaseFinancials } from "@/lib/profit";

export const dynamic = "force-dynamic";

/** GET /api/v1/purchases — every acquired copy, newest first. */
export const GET = apiRoute("READ", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const { limit, offset } = paging(request);
  const withFinancials = boolParam(request, "financials");

  const where: Prisma.PurchaseWhereInput = { userId };

  const itemId = stringParam(request, "itemId");
  if (itemId) where.itemId = itemId;
  const externalRef = stringParam(request, "externalRef");
  if (externalRef) where.externalRef = externalRef;

  const statuses = listParam(request, "status");
  if (statuses.length) where.status = { in: statuses as never };
  const graders = listParam(request, "grader");
  if (graders.length) where.grader = { in: graders as never };
  const sources = listParam(request, "source");
  if (sources.length) where.purchaseSource = { in: sources as never };

  const since = stringParam(request, "acquiredSince");
  const until = stringParam(request, "acquiredUntil");
  if (since || until) {
    where.acquiredAt = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lte: new Date(until) } : {}),
    };
  }

  const [purchases, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: {
        item: { select: { id: true, title: true, setName: true, number: true, type: true } },
        expenses: true,
        sales: true,
      },
      orderBy: [{ acquiredAt: "desc" }, { id: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.purchase.count({ where }),
  ]);

  const data = withFinancials
    ? purchases.map((p) => ({ ...p, financials: computePurchaseFinancials(p) }))
    : purchases;

  return apiOk(page(data, total, { limit, offset }));
});

const createSchema = purchaseSchema.extend({
  /** Which card this is a copy of; either identifier works. */
  itemId: z.string().nullish(),
  itemRef: z.string().nullish(),
});

/**
 * POST /api/v1/purchases — add one or more copies to cards that already exist.
 * Use POST /api/v1/items when the card itself is new.
 */
export const POST = apiRoute("WRITE", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const body = await jsonBody(request);
  const payloads = Array.isArray(body) ? body : [body];

  const parsed = createSchema.array().safeParse(payloads);
  if (!parsed.success) return invalidBody(parsed.error);

  const created = [];
  for (let index = 0; index < parsed.data.length; index += 1) {
    const input = parsed.data[index];
    const named = input.itemId?.trim() || input.itemRef?.trim() || "";
    if (!named) {
      return apiError("invalid_request", `purchases[${index}]: name a card with \`itemId\` or \`itemRef\`.`);
    }

    const item = await prisma.item.findFirst({
      where: { userId, OR: [{ id: named }, { externalRef: named }] },
      select: { id: true },
    });
    if (!item) {
      return apiError("not_found", `purchases[${index}]: no item matching "${named}".`);
    }

    const built = await buildPurchaseData(userId, input, `purchases[${index}]`);
    if (!built.ok) return apiError("invalid_request", built.error);

    const { externalRef, ...fields } = built.value;

    // An externalRef that's been seen before updates that copy rather than
    // adding a second one, so a re-run of the same push is a no-op.
    const existing = externalRef
      ? await prisma.purchase.findUnique({
          where: { userId_externalRef: { userId, externalRef } },
          select: { id: true },
        })
      : null;

    if (existing) {
      await prisma.purchase.updateMany({
        where: { id: existing.id, userId },
        data: { ...fields, itemId: item.id },
      });
      created.push({ id: existing.id, created: false });
    } else {
      const row = await prisma.purchase.create({
        data: { ...fields, externalRef, itemId: item.id },
        select: { id: true },
      });
      created.push({ id: row.id, created: true });
    }
  }

  return apiOk({ purchases: created }, 201);
});
