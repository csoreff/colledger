"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseDateInput } from "@/lib/dates";
import { parseMoneyToCents, parseMoneyToCentsOrZero } from "@/lib/money";
import { runCompSearch } from "@/lib/comps";
import {
  EXPENSE_CATEGORIES,
  GRADERS,
  ITEM_STATUSES,
  ITEM_TYPES,
  MARKETPLACES,
} from "@/lib/labels";

export type ActionState = { error?: string; ok?: boolean };

/** Zod's ZodError exposes `.issues`; `.errors` does not exist. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStr(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === "" ? null : value;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  type: z.enum(ITEM_TYPES as [ItemType, ...ItemType[]]),
  title: z.string().min(1, "Title is required."),
  setName: z.string().nullable(),
  number: z.string().nullable(),
  variant: z.string().nullable(),
  language: z.string().min(1),
  grader: z.enum(GRADERS as [Grader, ...Grader[]]),
  grade: z.string().nullable(),
  certNumber: z.string().nullable(),
  condition: z.string().nullable(),
  quantity: z.number().int().min(1, "Quantity must be at least 1."),
  acquiredAt: z.date({ message: "A valid purchase date is required." }),
  purchasePriceCents: z
    .number({ message: "Purchase price is required." })
    .int()
    .min(0, "Purchase price cannot be negative."),
  purchaseSource: z.enum(MARKETPLACES as [string, ...string[]]),
  purchaseNotes: z.string().nullable(),
  status: z.enum(ITEM_STATUSES as [string, ...string[]]),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  compQuery: z.string().nullable(),
});

function parseItemForm(form: FormData) {
  const quantityRaw = str(form, "quantity");
  return itemSchema.safeParse({
    type: str(form, "type"),
    title: str(form, "title"),
    setName: optionalStr(form, "setName"),
    number: optionalStr(form, "number"),
    variant: optionalStr(form, "variant"),
    language: str(form, "language") || "English",
    grader: str(form, "grader") || "RAW",
    grade: optionalStr(form, "grade"),
    certNumber: optionalStr(form, "certNumber"),
    condition: optionalStr(form, "condition"),
    quantity: quantityRaw === "" ? 1 : Number(quantityRaw),
    acquiredAt: parseDateInput(str(form, "acquiredAt")) ?? undefined,
    purchasePriceCents: parseMoneyToCents(str(form, "purchasePrice")) ?? undefined,
    purchaseSource: str(form, "purchaseSource") || "OTHER",
    purchaseNotes: optionalStr(form, "purchaseNotes"),
    status: str(form, "status") || "OWNED",
    imageUrl: optionalStr(form, "imageUrl"),
    notes: optionalStr(form, "notes"),
    compQuery: optionalStr(form, "compQuery"),
  });
}

export async function createItem(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = parseItemForm(form);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const item = await prisma.item.create({
    data: parsed.data as never,
  });

  revalidatePath("/");
  revalidatePath("/items");
  redirect(`/items/${item.id}`);
}

export async function updateItem(
  itemId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = parseItemForm(form);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  await prisma.item.update({ where: { id: itemId }, data: parsed.data as never });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  redirect(`/items/${itemId}`);
}

export async function deleteItem(itemId: string): Promise<void> {
  await prisma.item.delete({ where: { id: itemId } });
  revalidatePath("/");
  revalidatePath("/items");
  redirect("/items");
}

// ---------------------------------------------------------------------------
// Expenses — itemId null means a general (non-item) expense.
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  itemId: z.string().nullable(),
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  description: z.string().min(1, "Description is required."),
  amountCents: z
    .number({ message: "Amount is required." })
    .int()
    .refine((v) => v !== 0, "Amount cannot be zero."),
  incurredAt: z.date({ message: "A valid date is required." }),
  vendor: z.string().nullable(),
  notes: z.string().nullable(),
});

export async function createExpense(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = expenseSchema.safeParse({
    itemId: optionalStr(form, "itemId"),
    category: str(form, "category") || "OTHER",
    description: str(form, "description"),
    amountCents: parseMoneyToCents(str(form, "amount")) ?? undefined,
    incurredAt: parseDateInput(str(form, "incurredAt")) ?? undefined,
    vendor: optionalStr(form, "vendor"),
    notes: optionalStr(form, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  await prisma.expense.create({ data: parsed.data as never });

  revalidatePath("/");
  revalidatePath("/expenses");
  if (parsed.data.itemId) revalidatePath(`/items/${parsed.data.itemId}`);
  return { ok: true };
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const expense = await prisma.expense.delete({ where: { id: expenseId } });
  revalidatePath("/");
  revalidatePath("/expenses");
  if (expense.itemId) revalidatePath(`/items/${expense.itemId}`);
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

const saleSchema = z
  .object({
    itemId: z.string().min(1),
    soldAt: z.date({ message: "A valid sale date is required." }),
    platform: z.enum(MARKETPLACES as [string, ...string[]]),
    quantity: z.number().int().min(1),
    grossPriceCents: z
      .number({ message: "Sale price is required." })
      .int()
      .min(0, "Sale price cannot be negative."),
    shippingCollectedCents: z.number().int().min(0),
    platformFeeCents: z.number().int().min(0),
    shippingCostCents: z.number().int().min(0),
    otherFeeCents: z.number().int().min(0),
    wasBestOffer: z.boolean(),
    listedPriceCents: z.number().int().min(0).nullable(),
    buyer: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .refine((data) => !data.wasBestOffer || data.listedPriceCents !== null, {
    message: "Record the original asking price when the sale was a Best Offer.",
    path: ["listedPriceCents"],
  });

export async function createSale(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = saleSchema.safeParse({
    itemId: str(form, "itemId"),
    soldAt: parseDateInput(str(form, "soldAt")) ?? undefined,
    platform: str(form, "platform") || "EBAY",
    quantity: Number(str(form, "quantity") || "1"),
    grossPriceCents: parseMoneyToCents(str(form, "grossPrice")) ?? undefined,
    shippingCollectedCents: parseMoneyToCentsOrZero(str(form, "shippingCollected")),
    platformFeeCents: parseMoneyToCentsOrZero(str(form, "platformFee")),
    shippingCostCents: parseMoneyToCentsOrZero(str(form, "shippingCost")),
    otherFeeCents: parseMoneyToCentsOrZero(str(form, "otherFee")),
    wasBestOffer: form.get("wasBestOffer") === "on",
    listedPriceCents: parseMoneyToCents(str(form, "listedPrice")),
    buyer: optionalStr(form, "buyer"),
    notes: optionalStr(form, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  await prisma.sale.create({ data: parsed.data as never });

  // Recording a sale is what marks an item sold; no reason to make you do it twice.
  await prisma.item.update({
    where: { id: parsed.data.itemId },
    data: { status: "SOLD" },
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${parsed.data.itemId}`);
  return { ok: true };
}

export async function deleteSale(saleId: string): Promise<void> {
  const sale = await prisma.sale.delete({ where: { id: saleId } });

  const remaining = await prisma.sale.count({ where: { itemId: sale.itemId } });
  if (remaining === 0) {
    await prisma.item.update({ where: { id: sale.itemId }, data: { status: "OWNED" } });
  }

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${sale.itemId}`);
}

// ---------------------------------------------------------------------------
// Comps
// ---------------------------------------------------------------------------

export async function refreshComps(formData: FormData): Promise<void> {
  const query = str(formData, "query");
  if (!query) return;

  const graderRaw = str(formData, "grader");
  const typeRaw = str(formData, "itemType");

  await runCompSearch(
    {
      query,
      itemType: typeRaw ? (typeRaw as ItemType) : null,
      grader: graderRaw ? (graderRaw as Grader) : null,
      grade: optionalStr(formData, "grade"),
    },
    { force: true },
  );

  revalidatePath("/comps");
}

const manualCompSchema = z.object({
  searchId: z.string().min(1),
  title: z.string().min(1, "Title is required."),
  salePriceCents: z
    .number({ message: "Sale price is required." })
    .int()
    .min(0, "Sale price cannot be negative."),
  listedPriceCents: z.number().int().min(0).nullable(),
  soldAt: z.date().nullable(),
  url: z.string().nullable(),
  wasBestOffer: z.boolean(),
  grader: z.enum(GRADERS as [Grader, ...Grader[]]).nullable(),
  grade: z.string().nullable(),
});

export async function addManualComp(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const graderRaw = str(form, "grader");
  const parsed = manualCompSchema.safeParse({
    searchId: str(form, "searchId"),
    title: str(form, "title"),
    salePriceCents: parseMoneyToCents(str(form, "salePrice")) ?? undefined,
    listedPriceCents: parseMoneyToCents(str(form, "listedPrice")),
    soldAt: parseDateInput(str(form, "soldAt")),
    url: optionalStr(form, "url"),
    wasBestOffer: form.get("wasBestOffer") === "on",
    grader: graderRaw ? (graderRaw as Grader) : null,
    grade: optionalStr(form, "grade"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  await prisma.soldComp.create({
    data: {
      ...parsed.data,
      // Hand-entered comps are true by definition — you saw the real number.
      priceIsConfirmed: true,
      provider: "manual-entry",
    } as never,
  });

  revalidatePath("/comps");
  return { ok: true };
}

/** Fills in the true accepted price for a Best Offer the provider couldn't resolve. */
export async function setCompManualPrice(
  compId: string,
  priceInput: string,
): Promise<void> {
  const cents = parseMoneyToCents(priceInput);
  await prisma.soldComp.update({
    where: { id: compId },
    data: {
      manualPriceCents: cents,
      // Once you supply the number, the comp counts toward the stats.
      priceIsConfirmed: cents !== null ? true : undefined,
    },
  });
  revalidatePath("/comps");
}

export async function deleteComp(compId: string): Promise<void> {
  await prisma.soldComp.delete({ where: { id: compId } });
  revalidatePath("/comps");
}
