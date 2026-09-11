import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/tenant";
import { updateItem } from "@/lib/actions";
import { ItemForm } from "@/components/ItemForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditItemPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const item = await prisma.item.findFirst({
    where: { id: params.id, userId: user.id },
    include: { purchases: { orderBy: [{ acquiredAt: "asc" }, { id: "asc" }] } },
  });
  if (!item) notFound();

  const action = updateItem.bind(null, item.id);

  return (
    <>
      <PageHeader title="Edit item" subtitle={item.title} />
      <ItemForm
        action={action}
        item={item}
        purchases={item.purchases}
        submitLabel="Save changes"
      />
    </>
  );
}
