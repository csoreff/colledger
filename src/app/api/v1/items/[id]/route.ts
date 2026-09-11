import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { itemIdentitySchema } from "@/lib/api/input";
import { blankToNull } from "@/lib/api/input";
import { computeItemRollup } from "@/lib/profit";

export const dynamic = "force-dynamic";

type Params = { id: string };

/**
 * An item may be addressed by its database id or by the `externalRef` the
 * caller gave it, so a remote script can work purely in its own identifiers.
 */
function identify(userId: string, id: string) {
  return { userId, OR: [{ id }, { externalRef: id }] };
}

export const GET = apiRoute<Params>("READ", async ({ params, principal }) => {
  const item = await prisma.item.findFirst({
    where: identify(principal.targetUserId, params.id),
    include: {
      purchases: {
        orderBy: [{ acquiredAt: "asc" }, { id: "asc" }],
        include: { expenses: true, sales: true },
      },
    },
  });
  if (!item) return apiError("not_found", "No such item.");

  return apiOk({ ...item, rollup: computeItemRollup(item as never) });
});

/**
 * Partial update of the identity fields only. Copies are managed through
 * /api/v1/purchases, or by POSTing the item again with its `externalRef`.
 */
export const PATCH = apiRoute<Params>("WRITE", async ({ request, params, principal }) => {
  const userId = principal.targetUserId;

  const existing = await prisma.item.findFirst({
    where: identify(userId, params.id),
    select: { id: true },
  });
  if (!existing) return apiError("not_found", "No such item.");

  const parsed = itemIdentitySchema.partial().safeParse(await jsonBody(request));
  if (!parsed.success) return invalidBody(parsed.error);

  // Only the keys actually present are written: a PATCH that omits `notes`
  // means "leave the notes alone", not "clear them". Sending null clears.
  const data: Record<string, unknown> = {};
  const input = parsed.data as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    const value = input[key];
    data[key] =
      key === "type" || key === "title" || key === "language"
        ? value
        : typeof value === "string" || value === null || value === undefined
          ? blankToNull(value as string | null)
          : value;
  }

  if (Object.keys(data).length === 0) {
    return apiError("invalid_request", "No fields to update.");
  }

  await prisma.item.updateMany({ where: { id: existing.id, userId }, data: data as never });

  const item = await prisma.item.findFirst({
    where: { id: existing.id, userId },
    include: { purchases: true },
  });
  return apiOk(item);
});

/** Deletes the card and, by cascade, every copy, expense and sale under it. */
export const DELETE = apiRoute<Params>("WRITE", async ({ params, principal }) => {
  const userId = principal.targetUserId;

  const existing = await prisma.item.findFirst({
    where: identify(userId, params.id),
    select: { id: true, title: true },
  });
  if (!existing) return apiError("not_found", "No such item.");

  await prisma.item.deleteMany({ where: { id: existing.id, userId } });
  return apiOk({ deleted: true, id: existing.id, title: existing.title });
});
