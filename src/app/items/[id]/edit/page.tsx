import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { updateItem } from "@/lib/actions";
import { ItemForm } from "@/components/ItemForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditItemPage({ params }: { params: { id: string } }) {
  const item = await prisma.item.findUnique({ where: { id: params.id } });
  if (!item) notFound();

  const action = updateItem.bind(null, item.id);

  return (
    <>
      <PageHeader title="Edit item" subtitle={item.title} />
      <ItemForm action={action} item={item} submitLabel="Save changes" />
    </>
  );
}
