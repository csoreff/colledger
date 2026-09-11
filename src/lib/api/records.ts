/**
 * Building ledger rows from API payloads.
 *
 * Everything here takes an explicit `userId` — the one the request gate
 * resolved — and stamps it onto every row it writes. Nothing in this file
 * reads the session or decides for itself whose data it is touching.
 *
 * The write paths are upserts keyed on `externalRef` wherever the caller
 * supplies one, so a remote seed script can be re-run without duplicating what
 * it pushed last time. Without an `externalRef` a POST always inserts.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  blankToNull,
  resolveMoney,
  type MoneyInput,
  type expenseSchema,
  type itemWithPurchasesSchema,
  type purchaseSchema,
  type saleSchema,
} from "@/lib/api/input";
import type { z } from "zod";

export type Failure = { ok: false; error: string };
type Ok<T> = { ok: true; value: T };
export type Result<T> = Ok<T> | Failure;

type PurchaseInput = z.infer<typeof purchaseSchema>;
type ExpenseInput = z.infer<typeof expenseSchema>;
type SaleInput = z.infer<typeof saleSchema>;
type ItemInput = z.infer<typeof itemWithPurchasesSchema>;

/** Zero in both currencies, for the optional fee fields on a sale. */
const ZERO = { usdCents: 0, jpyYen: 0 };

async function money(
  input: MoneyInput | undefined,
  date: Date,
  label: string,
): Promise<Result<{ usdCents: number; jpyYen: number }>> {
  if (!input) return { ok: true, value: ZERO };
  const resolved = await resolveMoney(input, date, label);
  return resolved.ok ? { ok: true, value: resolved.value.money } : resolved;
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export async function buildPurchaseData(
  userId: string,
  input: PurchaseInput,
  label = "purchase",
): Promise<Result<Prisma.PurchaseUncheckedCreateWithoutItemInput>> {
  const price = await resolveMoney(input.price, input.acquiredAt, `${label} price`);
  if (!price.ok) return price;

  if (price.value.money.usdCents < 0 || price.value.money.jpyYen < 0) {
    return { ok: false, error: `${label}: price cannot be negative.` };
  }

  const graded = input.grader !== "RAW";

  return {
    ok: true,
    value: {
      userId,
      externalRef: blankToNull(input.externalRef),
      grader: input.grader as never,
      // Grade and cert belong to a slab; condition describes a raw copy. Keep
      // them mutually exclusive so a row can't claim to be both.
      grade: graded ? blankToNull(input.grade) : null,
      certNumber: graded ? blankToNull(input.certNumber) : null,
      condition: graded ? null : blankToNull(input.condition),
      quantity: input.quantity,
      acquiredAt: input.acquiredAt,
      purchaseSource: input.purchaseSource as never,
      purchaseUsdCents: price.value.money.usdCents,
      purchaseJpyYen: price.value.money.jpyYen,
      purchaseCurrency: price.value.currency,
      purchaseNativeMinor: price.value.nativeMinor,
      purchaseFxNativePerUsd: price.value.nativePerUsd,
      purchaseFxJpyPerUsd: price.value.fxJpyPerUsd,
      purchaseFxDate: price.value.fxDate,
      purchaseNotes: blankToNull(input.purchaseNotes),
      status: input.status as never,
      notes: blankToNull(input.notes),
    },
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function identityData(input: ItemInput) {
  return {
    type: input.type as never,
    title: input.title,
    setName: blankToNull(input.setName),
    number: blankToNull(input.number),
    variant: blankToNull(input.variant),
    language: input.language,
    imageUrl: blankToNull(input.imageUrl),
    notes: blankToNull(input.notes),
    compQuery: blankToNull(input.compQuery),
  };
}

export type ItemWriteOutcome = {
  id: string;
  created: boolean;
  purchasesCreated: number;
  purchasesUpdated: number;
};

/**
 * Creates or updates one item and the purchase rows sent with it.
 *
 * Matching is by `externalRef`. An item that already exists has its identity
 * fields replaced; its purchases are matched on their own `externalRef` and
 * updated in place, and any without one are appended.
 *
 * Purchases absent from the payload are deliberately left alone rather than
 * deleted. A push that names two copies is saying "these two exist", not "and
 * nothing else does" — deleting on absence would let a partial feed destroy
 * expenses and sales hanging off a copy it simply didn't mention.
 */
export async function upsertItem(
  userId: string,
  input: ItemInput,
): Promise<Result<ItemWriteOutcome>> {
  const rows: Prisma.PurchaseUncheckedCreateWithoutItemInput[] = [];
  for (let index = 0; index < input.purchases.length; index += 1) {
    const built = await buildPurchaseData(userId, input.purchases[index], `purchases[${index}]`);
    if (!built.ok) return built;
    rows.push(built.value);
  }

  const externalRef = blankToNull(input.externalRef);

  const existing = externalRef
    ? await prisma.item.findUnique({
        where: { userId_externalRef: { userId, externalRef } },
        select: { id: true },
      })
    : null;

  if (!existing) {
    const item = await prisma.item.create({
      data: {
        userId,
        externalRef,
        ...identityData(input),
        purchases: { create: rows },
      },
      select: { id: true },
    });
    return {
      ok: true,
      value: {
        id: item.id,
        created: true,
        purchasesCreated: rows.length,
        purchasesUpdated: 0,
      },
    };
  }

  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    await tx.item.updateMany({
      where: { id: existing.id, userId },
      data: identityData(input),
    });

    for (const row of rows) {
      const { externalRef: rowRef, ...fields } = row;
      const match = rowRef
        ? await tx.purchase.findFirst({
            where: { userId, externalRef: rowRef },
            select: { id: true },
          })
        : null;

      if (match) {
        await tx.purchase.updateMany({
          where: { id: match.id, userId },
          // Re-parent as well as update: a copy whose ref moved to a different
          // item should follow it rather than stay orphaned on the old one.
          data: { ...fields, itemId: existing.id },
        });
        updated += 1;
      } else {
        await tx.purchase.create({
          data: { ...fields, externalRef: rowRef, itemId: existing.id },
        });
        created += 1;
      }
    }
  });

  return {
    ok: true,
    value: { id: existing.id, created: false, purchasesCreated: created, purchasesUpdated: updated },
  };
}

// ---------------------------------------------------------------------------
// Pointing at a purchase
// ---------------------------------------------------------------------------

/**
 * Resolves whichever way the caller named a purchase.
 *
 * A remote script usually knows its own `externalRef` for a copy but not the
 * cuid this database gave it, so both are accepted. Either way the lookup is
 * scoped to the target user, so a foreign id resolves to nothing.
 */
export async function resolvePurchase(
  userId: string,
  named: { purchaseId?: string | null; purchaseRef?: string | null },
  required: boolean,
): Promise<Result<string | null>> {
  const id = blankToNull(named.purchaseId);
  const ref = blankToNull(named.purchaseRef);

  if (!id && !ref) {
    if (required) return { ok: false, error: "Name a purchase with `purchaseId` or `purchaseRef`." };
    return { ok: true, value: null };
  }

  const purchase = await prisma.purchase.findFirst({
    where: { userId, ...(id ? { id } : { externalRef: ref }) },
    select: { id: true },
  });
  if (!purchase) {
    return { ok: false, error: `No purchase matching ${id ? `id "${id}"` : `ref "${ref}"`}.` };
  }
  return { ok: true, value: purchase.id };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function buildExpenseData(
  userId: string,
  input: ExpenseInput,
  label = "expense",
): Promise<Result<Prisma.ExpenseUncheckedCreateInput>> {
  const purchase = await resolvePurchase(userId, input, false);
  if (!purchase.ok) return purchase;

  const amount = await resolveMoney(input.amount, input.incurredAt, `${label} amount`);
  if (!amount.ok) return amount;

  if (amount.value.money.usdCents === 0 && amount.value.money.jpyYen === 0) {
    return { ok: false, error: `${label}: amount cannot be zero.` };
  }

  return {
    ok: true,
    value: {
      userId,
      externalRef: blankToNull(input.externalRef),
      purchaseId: purchase.value,
      category: input.category as never,
      description: input.description,
      incurredAt: input.incurredAt,
      amountUsdCents: amount.value.money.usdCents,
      amountJpyYen: amount.value.money.jpyYen,
      // Expense has no native column, so an amount paid in GBP/AUD is recorded
      // as the converted pair and the currency is stored as the reporting one
      // it landed in. Same limitation the web form has.
      currency: (amount.value.currency === "GBP" || amount.value.currency === "AUD"
        ? "USD"
        : amount.value.currency) as never,
      fxJpyPerUsd: amount.value.fxJpyPerUsd,
      fxDate: amount.value.fxDate,
      vendor: blankToNull(input.vendor),
      notes: blankToNull(input.notes),
    },
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export async function buildSaleData(
  userId: string,
  input: SaleInput,
  label = "sale",
): Promise<Result<Prisma.SaleUncheckedCreateInput>> {
  const purchase = await resolvePurchase(userId, input, true);
  if (!purchase.ok) return purchase;

  const gross = await resolveMoney(input.grossPrice, input.soldAt, `${label} grossPrice`);
  if (!gross.ok) return gross;

  const shippingCollected = await money(input.shippingCollected, input.soldAt, `${label} shippingCollected`);
  if (!shippingCollected.ok) return shippingCollected;
  const platformFee = await money(input.platformFee, input.soldAt, `${label} platformFee`);
  if (!platformFee.ok) return platformFee;
  const shippingCost = await money(input.shippingCost, input.soldAt, `${label} shippingCost`);
  if (!shippingCost.ok) return shippingCost;
  const otherFee = await money(input.otherFee, input.soldAt, `${label} otherFee`);
  if (!otherFee.ok) return otherFee;

  const listed = input.listedPrice
    ? await resolveMoney(input.listedPrice, input.soldAt, `${label} listedPrice`)
    : null;
  if (listed && !listed.ok) return listed;

  // The asking price is the whole point of recording a Best Offer — without it
  // there is nothing to compare the accepted amount against.
  if (input.wasBestOffer && !listed) {
    return { ok: false, error: `${label}: a Best Offer sale needs \`listedPrice\` too.` };
  }

  return {
    ok: true,
    value: {
      userId,
      externalRef: blankToNull(input.externalRef),
      purchaseId: purchase.value as string,
      soldAt: input.soldAt,
      platform: input.platform as never,
      quantity: input.quantity,
      currency: (gross.value.currency === "GBP" || gross.value.currency === "AUD"
        ? "USD"
        : gross.value.currency) as never,
      fxJpyPerUsd: gross.value.fxJpyPerUsd,
      fxDate: gross.value.fxDate,
      grossPriceUsdCents: gross.value.money.usdCents,
      grossPriceJpyYen: gross.value.money.jpyYen,
      shippingCollectedUsdCents: shippingCollected.value.usdCents,
      shippingCollectedJpyYen: shippingCollected.value.jpyYen,
      platformFeeUsdCents: platformFee.value.usdCents,
      platformFeeJpyYen: platformFee.value.jpyYen,
      shippingCostUsdCents: shippingCost.value.usdCents,
      shippingCostJpyYen: shippingCost.value.jpyYen,
      otherFeeUsdCents: otherFee.value.usdCents,
      otherFeeJpyYen: otherFee.value.jpyYen,
      wasBestOffer: input.wasBestOffer,
      listedPriceUsdCents: listed?.ok ? listed.value.money.usdCents : null,
      listedPriceJpyYen: listed?.ok ? listed.value.money.jpyYen : null,
      buyer: blankToNull(input.buyer),
      notes: blankToNull(input.notes),
    },
  };
}

/**
 * Writes a sale — inserting or updating — and marks its copy sold, the way the
 * web form does.
 *
 * The two writes are one fact and are kept together so the API can't record a
 * sale that leaves the copy showing as still held. The status is re-asserted on
 * the update path as well as the insert, which matters more than it looks: a
 * re-pushed import carries each copy's `status` from the source payload, and
 * without this a copy that had been marked SOLD by an earlier run would regress
 * to OWNED while still having a sale recorded against it.
 */
export async function upsertSaleRow(
  userId: string,
  existingId: string | null,
  data: Prisma.SaleUncheckedCreateInput,
): Promise<{ id: string; created: boolean }> {
  return prisma.$transaction(async (tx) => {
    let id: string;
    if (existingId) {
      // `data` still carries the externalRef, but the row was found *by* that
      // ref, so writing it back is a no-op rather than something to strip out.
      await tx.sale.updateMany({ where: { id: existingId, userId }, data });
      id = existingId;
    } else {
      id = (await tx.sale.create({ data, select: { id: true } })).id;
    }

    await tx.purchase.updateMany({
      where: { id: data.purchaseId, userId },
      data: { status: "SOLD" },
    });

    return { id, created: !existingId };
  });
}
