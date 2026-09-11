import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { purchaseSchema } from "@/lib/api/input";
import { buildPurchaseData } from "@/lib/api/records";
import { computePurchaseFinancials } from "@/lib/profit";

export const dynamic = "force-dynamic";

type Params = { id: string };

function identify(userId: string, id: string) {
  return { userId, OR: [{ id }, { externalRef: id }] };
}

export const GET = apiRoute<Params>("READ", async ({ params, principal }) => {
  const purchase = await prisma.purchase.findFirst({
    where: identify(principal.targetUserId, params.id),
    include: { item: true, expenses: true, sales: true },
  });
  if (!purchase) return apiError("not_found", "No such purchase.");

  return apiOk({ ...purchase, financials: computePurchaseFinancials(purchase) });
});

/**
 * Replaces a copy's fields.
 *
 * This is a full replace rather than a merge, because the money fields are
 * interdependent: price, currency and FX date are derived together, so
 * accepting a new price without its date would produce a pair converted at the
 * wrong rate. Send the whole copy.
 */
export const PUT = apiRoute<Params>("WRITE", async ({ request, params, principal }) => {
  const userId = principal.targetUserId;

  const existing = await prisma.purchase.findFirst({
    where: identify(userId, params.id),
    select: { id: true },
  });
  if (!existing) return apiError("not_found", "No such purchase.");

  const parsed = purchaseSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return invalidBody(parsed.error);

  const built = await buildPurchaseData(userId, parsed.data);
  if (!built.ok) return apiError("invalid_request", built.error);

  await prisma.purchase.updateMany({
    where: { id: existing.id, userId },
    data: built.value,
  });

  const purchase = await prisma.purchase.findFirst({
    where: { id: existing.id, userId },
    include: { expenses: true, sales: true },
  });
  return apiOk(purchase);
});

export const PATCH = PUT;

export const DELETE = apiRoute<Params>("WRITE", async ({ params, principal }) => {
  const userId = principal.targetUserId;

  const existing = await prisma.purchase.findFirst({
    where: identify(userId, params.id),
    select: { id: true },
  });
  if (!existing) return apiError("not_found", "No such purchase.");

  await prisma.purchase.deleteMany({ where: { id: existing.id, userId } });
  return apiOk({ deleted: true, id: existing.id });
});
