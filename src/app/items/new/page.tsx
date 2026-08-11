import { createItem } from "@/lib/actions";
import { ItemForm } from "@/components/ItemForm";
import { PageHeader } from "@/components/ui";

export default function NewItemPage() {
  return (
    <>
      <PageHeader title="Add item" subtitle="A card or a manga volume you've acquired." />
      <ItemForm action={createItem} submitLabel="Save item" />
    </>
  );
}
