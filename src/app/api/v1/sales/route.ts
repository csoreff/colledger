import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { saleSchema } from "@/lib/api/input";
import { buildSaleData, upsertSaleRow } from "@/lib/api/records";
import { listParam, page, paging, stringParam } from "@/lib/api/query";
import { saleNetMoney } from "@/lib/profit";

export const dynamic = "force-dynamic";

export const GET = apiRoute("READ", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const { limit, offset } = paging(request);

  const where: Prisma.SaleWhereInput = { userId };

  const purchaseId = stringParam(request, "purchaseId");
  if (purchaseId) where.purchaseId = purchaseId;
  const externalRef = stringParam(request, "externalRef");
  if (externalRef) where.externalRef = externalRef;

  const platforms = listParam(request, "platform");
  if (platforms.length) where.platform = { in: platforms as never };

  const since = stringParam(request, "since");
  const until = stringParam(request, "until");
  if (since || until) {
    where.soldAt = {
      ...(since ? { gte: new Date(since) } : {}),
      ...(until ? { lte: new Date(until) } : {}),
    };
  }

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        purchase: {
          select: {
            id: true,
            externalRef: true,
            grader: true,
            grade: true,
            item: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { soldAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.sale.count({ where }),
  ]);

  // Net of fees and postage, which is the number anyone asking about a sale
  // actually wants; gross alone reads as more than was received.
  const data = sales.map((sale) => ({ ...sale, net: saleNetMoney(sale) }));

  return apiOk(page(data, total, { limit, offset }));
});

/**
 * POST /api/v1/sales — record one or more sales.
 *
 * Recording a sale also marks its copy SOLD, exactly as the web form does.
 */
export const POST = apiRoute("WRITE", async ({ request, principal }) => {
  const userId = principal.targetUserId;
  const body = await jsonBody(request);
  const payloads = Array.isArray(body) ? body : [body];

  const parsed = saleSchema.array().safeParse(payloads);
  if (!parsed.success) return invalidBody(parsed.error);

  const results = [];
  for (let index = 0; index < parsed.data.length; index += 1) {
    const built = await buildSaleData(userId, parsed.data[index], `sales[${index}]`);
    if (!built.ok) return apiError("invalid_request", built.error);

    const externalRef = built.value.externalRef;
    const existing = externalRef
      ? await prisma.sale.findUnique({
          where: { userId_externalRef: { userId, externalRef } },
          select: { id: true },
        })
      : null;

    results.push(await upsertSaleRow(userId, existing?.id ?? null, built.value));
  }

  return apiOk({ sales: results }, 201);
});
