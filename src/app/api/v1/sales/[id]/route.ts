import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute } from "@/lib/api/http";
import { saleNetMoney } from "@/lib/profit";

export const dynamic = "force-dynamic";

type Params = { id: string };

function identify(userId: string, id: string) {
  return { userId, OR: [{ id }, { externalRef: id }] };
}

export const GET = apiRoute<Params>("READ", async ({ params, principal }) => {
  const sale = await prisma.sale.findFirst({
    where: identify(principal.targetUserId, params.id),
    include: { purchase: { include: { item: true } } },
  });
  if (!sale) return apiError("not_found", "No such sale.");
  return apiOk({ ...sale, net: saleNetMoney(sale) });
});

/**
 * Deleting the last sale of a copy puts it back into inventory, mirroring the
 * web app — otherwise an undone sale would leave a card permanently marked
 * SOLD with no sale to show for it.
 */
export const DELETE = apiRoute<Params>("WRITE", async ({ params, principal }) => {
  const userId = principal.targetUserId;

  const sale = await prisma.sale.findFirst({
    where: identify(userId, params.id),
    select: { id: true, purchaseId: true },
  });
  if (!sale) return apiError("not_found", "No such sale.");

  await prisma.sale.deleteMany({ where: { id: sale.id, userId } });

  const remaining = await prisma.sale.count({
    where: { purchaseId: sale.purchaseId, userId },
  });
  if (remaining === 0) {
    await prisma.purchase.updateMany({
      where: { id: sale.purchaseId, userId },
      data: { status: "OWNED" },
    });
  }

  return apiOk({ deleted: true, id: sale.id, purchaseReturnedToInventory: remaining === 0 });
});
