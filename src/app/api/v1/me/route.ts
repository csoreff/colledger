import { prisma } from "@/lib/prisma";
import { apiOk, apiRoute } from "@/lib/api/http";

export const dynamic = "force-dynamic";

/**
 * Who this key is, what it can do, and whose ledger it is currently pointed
 * at. The first call to make when wiring up a script — it confirms the key
 * works and that `X-Ledger-User` resolved to the account you expected.
 */
export const GET = apiRoute("READ", async ({ principal }) => {
  const target = await prisma.user.findUnique({
    where: { id: principal.targetUserId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      _count: { select: { items: true, purchases: true, expenses: true, sales: true } },
    },
  });

  return apiOk({
    key: { id: principal.keyId, scopes: principal.scopes },
    actor: {
      id: principal.actorId,
      email: principal.actorEmail,
      role: principal.actorRole,
    },
    actingOn: target,
    isImpersonating: principal.isImpersonating,
  });
});
