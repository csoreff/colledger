import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { expenseSchema } from "@/lib/api/input";
import { buildExpenseData } from "@/lib/api/records";

export const dynamic = "force-dynamic";

type Params = { id: string };

function identify(userId: string, id: string) {
  return { userId, OR: [{ id }, { externalRef: id }] };
}

export const GET = apiRoute<Params>("READ", async ({ params, principal }) => {
  const expense = await prisma.expense.findFirst({
    where: identify(principal.targetUserId, params.id),
  });
  if (!expense) return apiError("not_found", "No such expense.");
  return apiOk(expense);
});

/** Full replace — see the note on PUT /api/v1/purchases/[id] about why. */
export const PUT = apiRoute<Params>("WRITE", async ({ request, params, principal }) => {
  const userId = principal.targetUserId;

  const existing = await prisma.expense.findFirst({
    where: identify(userId, params.id),
    select: { id: true },
  });
  if (!existing) return apiError("not_found", "No such expense.");

  const parsed = expenseSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return invalidBody(parsed.error);

  const built = await buildExpenseData(userId, parsed.data);
  if (!built.ok) return apiError("invalid_request", built.error);

  await prisma.expense.updateMany({ where: { id: existing.id, userId }, data: built.value });

  return apiOk(await prisma.expense.findFirst({ where: { id: existing.id, userId } }));
});

export const PATCH = PUT;

export const DELETE = apiRoute<Params>("WRITE", async ({ params, principal }) => {
  const userId = principal.targetUserId;

  const existing = await prisma.expense.findFirst({
    where: identify(userId, params.id),
    select: { id: true },
  });
  if (!existing) return apiError("not_found", "No such expense.");

  await prisma.expense.deleteMany({ where: { id: existing.id, userId } });
  return apiOk({ deleted: true, id: existing.id });
});
