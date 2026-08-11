"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Currency, Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseDateInput } from "@/lib/dates";
import { FxUnavailableError, getRateForDate, type FxLookup } from "@/lib/fx";
import {
  makeMoney,
  parseJpyToYen,
  parseUsdToCents,
  ZERO_MONEY,
  type Money,
} from "@/lib/currency";
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

function currencyOf(form: FormData, key = "currency"): Currency {
  return str(form, key) === "JPY" ? "JPY" : "USD";
}

// ---------------------------------------------------------------------------
// Money resolution
//
// A form submits each amount twice, `<name>Usd` and `<name>Jpy`. Normally the
// browser has already filled both at the rate for the transaction date. When
// only one side arrives — JS off, or the rate hadn't loaded — the missing side
// is computed here from the rate for that date, so the pair is always complete.
// ---------------------------------------------------------------------------

type MoneyResolver = {
  rate: FxLookup | null;
  rateError: string | null;
  /** Returns null when neither side was supplied. */
  resolve(form: FormData, name: string, currency: Currency): Money | null;
  /** Same, but zero when absent. */
  resolveOrZero(form: FormData, name: string, currency: Currency): Money;
  /** True when some field still needs a rate we don't have. */
  needsRate: boolean;
};

async function moneyResolver(date: Date): Promise<MoneyResolver> {
  let rate: FxLookup | null = null;
  let rateError: string | null = null;
  try {
    rate = await getRateForDate(date);
  } catch (error) {
    rateError = error instanceof FxUnavailableError ? error.message : "Exchange rate unavailable.";
  }

  const resolver: MoneyResolver = {
    rate,
    rateError,
    needsRate: false,
    resolve(form, name, currency) {
      const usdCents = parseUsdToCents(str(form, `${name}Usd`));
      const jpyYen = parseJpyToYen(str(form, `${name}Jpy`));

      if (usdCents === null && jpyYen === null) return null;
      if (usdCents !== null && jpyYen !== null) return { usdCents, jpyYen };

      // One side only — conversion required.
      if (!rate) {
        resolver.needsRate = true;
        return usdCents !== null
          ? { usdCents, jpyYen: 0 }
          : { usdCents: 0, jpyYen: jpyYen ?? 0 };
      }
      return makeMoney({ usdCents, jpyYen }, rate.jpyPerUsd, currency);
    },
    resolveOrZero(form, name, currency) {
      return resolver.resolve(form, name, currency) ?? ZERO_MONEY;
    },
  };

  return resolver;
}

/** Rate provenance columns, shared by every money-bearing record. */
function fxColumns(resolver: MoneyResolver) {
  return {
    fxJpyPerUsd: resolver.rate?.jpyPerUsd ?? null,
    fxDate: resolver.rate?.effectiveDate ?? null,
  };
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
  purchaseUsdCents: z.number().int().min(0, "Purchase price cannot be negative."),
  purchaseJpyYen: z.number().int().min(0, "Purchase price cannot be negative."),
  purchaseCurrency: z.enum(["USD", "JPY"]),
  purchaseSource: z.enum(MARKETPLACES as [string, ...string[]]),
  purchaseNotes: z.string().nullable(),
  status: z.enum(ITEM_STATUSES as [string, ...string[]]),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  compQuery: z.string().nullable(),
});

async function parseItemForm(form: FormData) {
  const acquiredAt = parseDateInput(str(form, "acquiredAt"));
  const currency = currencyOf(form, "purchaseCurrency");
  const resolver = await moneyResolver(acquiredAt ?? new Date());
  const purchase = resolver.resolve(form, "purchase", currency);

  const quantityRaw = str(form, "quantity");
  const parsed = itemSchema.safeParse({
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
    acquiredAt: acquiredAt ?? undefined,
    purchaseUsdCents: purchase?.usdCents,
    purchaseJpyYen: purchase?.jpyYen,
    purchaseCurrency: currency,
    purchaseSource: str(form, "purchaseSource") || "OTHER",
    purchaseNotes: optionalStr(form, "purchaseNotes"),
    status: str(form, "status") || "OWNED",
    imageUrl: optionalStr(form, "imageUrl"),
    notes: optionalStr(form, "notes"),
    compQuery: optionalStr(form, "compQuery"),
  });

  return { parsed, resolver, purchase };
}

function itemData(parsed: z.infer<typeof itemSchema>, resolver: MoneyResolver) {
  const fx = fxColumns(resolver);
  return {
    ...parsed,
    purchaseFxJpyPerUsd: fx.fxJpyPerUsd,
    purchaseFxDate: fx.fxDate,
  };
}

export async function createItem(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { parsed, resolver, purchase } = await parseItemForm(form);
  if (!purchase) return { error: "Enter the purchase price in USD or JPY." };
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (resolver.needsRate) return { error: resolver.rateError ?? "Exchange rate unavailable." };

  const item = await prisma.item.create({ data: itemData(parsed.data, resolver) as never });

  revalidatePath("/");
  revalidatePath("/items");
  redirect(`/items/${item.id}`);
}

export async function updateItem(
  itemId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { parsed, resolver, purchase } = await parseItemForm(form);
  if (!purchase) return { error: "Enter the purchase price in USD or JPY." };
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (resolver.needsRate) return { error: resolver.rateError ?? "Exchange rate unavailable." };

  await prisma.item.update({
    where: { id: itemId },
    data: itemData(parsed.data, resolver) as never,
  });

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
  amountUsdCents: z.number().int(),
  amountJpyYen: z.number().int(),
  currency: z.enum(["USD", "JPY"]),
  incurredAt: z.date({ message: "A valid date is required." }),
  vendor: z.string().nullable(),
  notes: z.string().nullable(),
});

export async function createExpense(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const incurredAt = parseDateInput(str(form, "incurredAt"));
  const currency = currencyOf(form);
  const resolver = await moneyResolver(incurredAt ?? new Date());
  const amount = resolver.resolve(form, "amount", currency);

  if (!amount) return { error: "Enter the amount in USD or JPY." };
  if (amount.usdCents === 0 && amount.jpyYen === 0) {
    return { error: "Amount cannot be zero." };
  }

  const parsed = expenseSchema.safeParse({
    itemId: optionalStr(form, "itemId"),
    category: str(form, "category") || "OTHER",
    description: str(form, "description"),
    amountUsdCents: amount.usdCents,
    amountJpyYen: amount.jpyYen,
    currency,
    incurredAt: incurredAt ?? undefined,
    vendor: optionalStr(form, "vendor"),
    notes: optionalStr(form, "notes"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (resolver.needsRate) return { error: resolver.rateError ?? "Exchange rate unavailable." };

  await prisma.expense.create({
    data: { ...parsed.data, ...fxColumns(resolver) } as never,
  });

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

export async function createSale(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const itemId = str(form, "itemId");
  const soldAt = parseDateInput(str(form, "soldAt"));
  if (!itemId) return { error: "Missing item." };
  if (!soldAt) return { error: "A valid sale date is required." };

  const currency = currencyOf(form);
  const resolver = await moneyResolver(soldAt);

  const gross = resolver.resolve(form, "grossPrice", currency);
  if (!gross) return { error: "Enter the sale price in USD or JPY." };

  const wasBestOffer = form.get("wasBestOffer") === "on";
  const listed = resolver.resolve(form, "listedPrice", currency);
  if (wasBestOffer && !listed) {
    return { error: "Record the original asking price when the sale was a Best Offer." };
  }

  const shippingCollected = resolver.resolveOrZero(form, "shippingCollected", currency);
  const platformFee = resolver.resolveOrZero(form, "platformFee", currency);
  const shippingCost = resolver.resolveOrZero(form, "shippingCost", currency);
  const otherFee = resolver.resolveOrZero(form, "otherFee", currency);

  if (resolver.needsRate) return { error: resolver.rateError ?? "Exchange rate unavailable." };

  const quantity = Number(str(form, "quantity") || "1");
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { error: "Quantity must be a whole number of at least 1." };
  }

  await prisma.sale.create({
    data: {
      itemId,
      soldAt,
      platform: (str(form, "platform") || "EBAY") as never,
      quantity,
      currency,
      ...fxColumns(resolver),
      grossPriceUsdCents: gross.usdCents,
      grossPriceJpyYen: gross.jpyYen,
      shippingCollectedUsdCents: shippingCollected.usdCents,
      shippingCollectedJpyYen: shippingCollected.jpyYen,
      platformFeeUsdCents: platformFee.usdCents,
      platformFeeJpyYen: platformFee.jpyYen,
      shippingCostUsdCents: shippingCost.usdCents,
      shippingCostJpyYen: shippingCost.jpyYen,
      otherFeeUsdCents: otherFee.usdCents,
      otherFeeJpyYen: otherFee.jpyYen,
      wasBestOffer,
      listedPriceUsdCents: listed?.usdCents ?? null,
      listedPriceJpyYen: listed?.jpyYen ?? null,
      buyer: optionalStr(form, "buyer"),
      notes: optionalStr(form, "notes"),
    } as never,
  });

  // Recording a sale is what marks an item sold; no reason to do it twice.
  await prisma.item.update({ where: { id: itemId }, data: { status: "SOLD" } });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
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

export async function addManualComp(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const searchId = str(form, "searchId");
  const title = str(form, "title");
  if (!searchId) return { error: "Missing search." };
  if (!title) return { error: "Title is required." };

  const soldAt = parseDateInput(str(form, "soldAt"));
  const currency = currencyOf(form);
  const resolver = await moneyResolver(soldAt ?? new Date());

  const salePrice = resolver.resolve(form, "salePrice", currency);
  if (!salePrice) return { error: "Enter the sale price in USD or JPY." };
  const listedPrice = resolver.resolve(form, "listedPrice", currency);

  if (resolver.needsRate) return { error: resolver.rateError ?? "Exchange rate unavailable." };

  const graderRaw = str(form, "grader");

  await prisma.soldComp.create({
    data: {
      searchId,
      title,
      url: optionalStr(form, "url"),
      soldAt,
      currency,
      ...fxColumns(resolver),
      salePriceUsdCents: salePrice.usdCents,
      salePriceJpyYen: salePrice.jpyYen,
      listedPriceUsdCents: listedPrice?.usdCents ?? null,
      listedPriceJpyYen: listedPrice?.jpyYen ?? null,
      wasBestOffer: form.get("wasBestOffer") === "on",
      // Hand-entered comps are true by definition — you saw the real number.
      priceIsConfirmed: true,
      grader: graderRaw ? (graderRaw as Grader) : null,
      grade: optionalStr(form, "grade"),
      provider: "manual-entry",
    } as never,
  });

  revalidatePath("/comps");
  return { ok: true };
}

/** Fills in the true accepted price for a Best Offer the provider couldn't resolve. */
export async function setCompManualPrice(
  compId: string,
  usdInput: string,
  jpyInput: string,
): Promise<void> {
  const comp = await prisma.soldComp.findUnique({ where: { id: compId } });
  if (!comp) return;

  const usdCents = parseUsdToCents(usdInput);
  const jpyYen = parseJpyToYen(jpyInput);

  if (usdCents === null && jpyYen === null) {
    await prisma.soldComp.update({
      where: { id: compId },
      data: { manualPriceUsdCents: null, manualPriceJpyYen: null },
    });
    revalidatePath("/comps");
    return;
  }

  const resolver = await moneyResolver(comp.soldAt ?? new Date());
  const money =
    usdCents !== null && jpyYen !== null
      ? { usdCents, jpyYen }
      : resolver.rate
        ? makeMoney({ usdCents, jpyYen }, resolver.rate.jpyPerUsd, comp.currency)
        : { usdCents: usdCents ?? 0, jpyYen: jpyYen ?? 0 };

  await prisma.soldComp.update({
    where: { id: compId },
    data: {
      manualPriceUsdCents: money.usdCents,
      manualPriceJpyYen: money.jpyYen,
      // Once you supply the number, the comp counts toward the stats.
      priceIsConfirmed: true,
    },
  });
  revalidatePath("/comps");
}

export async function deleteComp(compId: string): Promise<void> {
  await prisma.soldComp.delete({ where: { id: compId } });
  revalidatePath("/comps");
}
