import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/tenant";
import {
  addPurchase,
  deleteExpense,
  deleteItem,
  deletePurchase,
  deleteSale,
  updatePurchase,
} from "@/lib/actions";
import {
  computeItemRollup,
  computePurchaseFinancials,
  saleNetMoney,
} from "@/lib/profit";
import { formatPercent } from "@/lib/currency";
import { ITEM_TYPE_LABELS } from "@/lib/labels";
import { Chip, PageHeader } from "@/components/ui";
import { MoneyProfit, MoneyValue } from "@/components/Money";
import { DeleteButton } from "@/components/DeleteButton";
import { AddPurchaseForm } from "@/components/ItemForm";
import { PurchaseCard } from "@/components/PurchaseCard";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  // findFirst, not findUnique: the lookup is by id *and* owner, so another
  // account's item is a 404 here rather than a readable page.
  const item = await prisma.item.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      purchases: {
        orderBy: [{ acquiredAt: "asc" }, { id: "asc" }],
        include: {
          expenses: { orderBy: { incurredAt: "desc" } },
          sales: { orderBy: { soldAt: "desc" } },
        },
      },
    },
  });
  if (!item) notFound();

  const rollup = computeItemRollup(item);

  const compsHref = `/comps?${new URLSearchParams({
    q: item.compQuery || [item.setName, item.title, item.number].filter(Boolean).join(" "),
    itemType: item.type,
  })}`;

  const addPurchaseAction = addPurchase.bind(null, item.id);

  return (
    <>
      <PageHeader
        title={item.title}
        subtitle={[
          ITEM_TYPE_LABELS[item.type],
          item.setName,
          item.number ? `#${item.number}` : null,
          item.variant,
          item.language,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={compsHref} className="btn-secondary">
              <Search className="h-4 w-4" />
              Look up comps
            </Link>
            <Link href={`/items/${item.id}/edit`} className="btn-secondary">
              Edit
            </Link>
            <DeleteButton
              action={deleteItem.bind(null, item.id)}
              label="Delete item"
              confirmMessage={`Delete "${item.title}" and all ${rollup.copies} of its purchases?`}
            />
          </div>
        }
      />

      {/* --- Rollup across every copy --- */}
      <section className="card mb-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Chip>
            {rollup.units} card{rollup.units === 1 ? "" : "s"}
          </Chip>
          <Chip>
            {rollup.copies} purchase{rollup.copies === 1 ? "" : "s"}
          </Chip>
          <Chip tone={rollup.heldUnits > 0 ? "sky" : "slate"}>{rollup.heldUnits} held</Chip>
          <Chip tone={rollup.soldUnits > 0 ? "emerald" : "slate"}>
            {rollup.soldUnits} sold
          </Chip>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-xs text-slate-500">Total cost basis</dt>
            <dd className="mt-1 font-medium">
              <MoneyValue money={rollup.costBasis} align="left" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Still held</dt>
            <dd className="mt-1">
              <MoneyValue money={rollup.inventoryCostBasis} align="left" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Net proceeds</dt>
            <dd className="mt-1">
              {rollup.soldCount > 0 ? (
                <MoneyValue money={rollup.netProceeds} align="left" />
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Realized profit</dt>
            <dd className="mt-1">
              <MoneyProfit money={rollup.realizedProfit} align="left" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Return on sold</dt>
            <dd className="mt-1 text-sm">
              {rollup.roi.usd !== null ? (
                <span className="text-slate-300">
                  {formatPercent(rollup.roi.usd)} USD
                  <span className="block text-xs text-slate-500">
                    {formatPercent(rollup.roi.jpy)} JPY
                  </span>
                </span>
              ) : (
                <span className="text-slate-500">—</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {item.notes ? (
        <section className="card mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Notes
          </h2>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{item.notes}</p>
        </section>
      ) : null}

      {/* --- One block per copy --- */}
      <section className="card mb-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Purchases
        </h2>
        <div className="space-y-3">
          {item.purchases.map((purchase, index) => (
            <PurchaseCard
              key={purchase.id}
              purchase={purchase}
              index={index}
              fin={computePurchaseFinancials(purchase)}
              sales={purchase.sales.map((sale) => ({ ...sale, net: saleNetMoney(sale) }))}
              itemType={item.type}
              updatePurchase={updatePurchase.bind(null, purchase.id)}
              deletePurchase={deletePurchase.bind(null, purchase.id)}
              deleteExpense={deleteExpense}
              deleteSale={deleteSale}
              defaultOpen={item.purchases.length === 1}
            />
          ))}
        </div>
      </section>

      <AddPurchaseForm action={addPurchaseAction} itemType={item.type} />

      {item.imageUrl ? (
        <a
          href={item.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-emerald-400"
        >
          View image <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}
    </>
  );
}
