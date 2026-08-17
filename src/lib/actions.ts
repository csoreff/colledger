"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Currency, Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseDateInput } from "@/lib/dates";
import { FxUnavailableError, getRateForDate, type FxLookup } from "@/lib/fx";
import {
  CURRENCIES,
  isReportingCurrency,
  makeMoney,
  nativeToMoney,
  parseJpyToYen,
  parseToMinor,
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
  const value = str(form, key);
  // Validate against the full list rather than testing for JPY: when this only
  // knew about USD and JPY, a GBP submission fell through to USD and the
  // currency was silently lost while the converted amounts still looked right.
  return CURRENCIES.includes(value as Currency) ? (value as Currency) : "USD";
}

// ---------------------------------------------------------------------------
// Money resolution
//
// A form submits each amount twice, `<name>Usd` and `<name>Jpy`. Normally the
// browser has already filled both at the rate for the transaction date. When
// only one side arrives — JS off, or the rate hadn't loaded — the missing side
// is computed here from the rate for that date, so the pair is always complete.
// ---------------------------------------------------------------------------

/** An amount plus, when it settled in GBP/AUD, the native figure behind it. */
export type ResolvedAmount = {
  money: Money;
  /** Minor units of the transaction currency; null for USD/JPY, which are
   *  already carried by `money`. */
  nativeMinor: number | null;
  /** Units of the transaction currency per 1 USD on that date. */
  nativePerUsd: number | null;
};

type MoneyResolver = {
  rate: FxLookup | null;
  rateError: string | null;
  /** Returns null when neither side was supplied. */
  resolve(form: FormData, name: string, currency: Currency): Money | null;
  /** Same, but zero when absent. */
  resolveOrZero(form: FormData, name: string, currency: Currency): Money;
  /** Resolves an amount that may have settled in GBP or AUD. */
  resolveNative(
    form: FormData,
    name: string,
    currency: Currency,
  ): ResolvedAmount | null;
  /** True when some field still needs a rate we don't have. */
  needsRate: boolean;
};

async function moneyResolver(
  date: Date,
  currency: Currency = "JPY",
): Promise<MoneyResolver> {
  let rate: FxLookup | null = null;
  let rateError: string | null = null;
  try {
    rate = await getRateForDate(date, currency);
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
    resolveNative(form, name, currency) {
      // USD and JPY are already the reporting pair, so there is no separate
      // native figure to keep.
      if (isReportingCurrency(currency)) {
        const money = resolver.resolve(form, name, currency);
        return money
          ? {
              money,
              nativeMinor: currency === "JPY" ? money.jpyYen : money.usdCents,
              nativePerUsd: currency === "JPY" ? (rate?.jpyPerUsd ?? null) : 1,
            }
          : null;
      }

      const nativeMinor = parseToMinor(str(form, `${name}Native`), currency);
      const usdCents = parseUsdToCents(str(form, `${name}Usd`));
      const jpyYen = parseJpyToYen(str(form, `${name}Jpy`));
      if (nativeMinor === null && usdCents === null && jpyYen === null) return null;

      const nativePerUsd = rate?.rates?.[currency] ?? null;

      // Typed USD/JPY figures win — a marketplace's own conversion beats a
      // mid-market rate, and this is the fallback when no rate is published.
      if (usdCents !== null && jpyYen !== null) {
        return { money: { usdCents, jpyYen }, nativeMinor, nativePerUsd };
      }

      if (nativeMinor !== null && rate?.rates) {
        const money = nativeToMoney({ minor: nativeMinor, currency }, rate.rates);
        if (money) return { money, nativeMinor, nativePerUsd };
      }

      // Only a partial figure and no usable rate: keep what was typed rather
      // than inventing the rest, and let the caller report it.
      resolver.needsRate = true;
      return {
        money: { usdCents: usdCents ?? 0, jpyYen: jpyYen ?? 0 },
        nativeMinor,
        nativePerUsd,
      };
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
// Items (identity) and their Purchases (one row per copy acquired)
//
// The form submits purchase rows with keys namespaced by a per-row id:
// `p<rowId>_acquiredAt`, `p<rowId>_purchaseUsd`, and so on. Namespacing rather
// than parallel arrays keeps rows intact when a field is conditionally
// rendered (the grade box only exists on graded rows) or a middle row removed.
// ---------------------------------------------------------------------------

const identitySchema = z.object({
  type: z.enum(ITEM_TYPES as [ItemType, ...ItemType[]]),
  title: z.string().min(1, "Title is required."),
  setName: z.string().nullable(),
  number: z.string().nullable(),
  variant: z.string().nullable(),
  language: z.string().min(1),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  compQuery: z.string().nullable(),
});

function parseIdentity(form: FormData) {
  return identitySchema.safeParse({
    type: str(form, "type"),
    title: str(form, "title"),
    setName: optionalStr(form, "setName"),
    number: optionalStr(form, "number"),
    variant: optionalStr(form, "variant"),
    language: str(form, "language") || "English",
    imageUrl: optionalStr(form, "imageUrl"),
    notes: optionalStr(form, "notes"),
    compQuery: optionalStr(form, "compQuery"),
  });
}

/** Row ids present in the form, in the order the browser serialized them. */
function purchaseRowIds(form: FormData): string[] {
  const ids: string[] = [];
  form.forEach((_value, key) => {
    const match = /^p([A-Za-z0-9]+)_acquiredAt$/.exec(key);
    if (match && !ids.includes(match[1])) ids.push(match[1]);
  });
  return ids;
}

export type PurchaseInput = {
  id?: string;
  grader: Grader;
  grade: string | null;
  certNumber: string | null;
  condition: string | null;
  quantity: number;
  acquiredAt: Date;
  purchaseSource: string;
  purchaseCurrency: Currency;
  purchaseUsdCents: number;
  purchaseJpyYen: number;
  purchaseNativeMinor: number | null;
  purchaseFxNativePerUsd: number | null;
  purchaseFxJpyPerUsd: number | null;
  purchaseFxDate: Date | null;
  purchaseNotes: string | null;
  status: string;
};

/** Builds one purchase row, or an error message describing what's missing. */
async function buildPurchaseRow(
  form: FormData,
  rowId: string,
  index: number,
): Promise<{ row: PurchaseInput } | { error: string }> {
  const label = `Purchase ${index + 1}`;
  const field = (name: string) => `p${rowId}_${name}`;

  const acquiredAt = parseDateInput(str(form, field("acquiredAt")));
  if (!acquiredAt) return { error: `${label}: a valid purchase date is required.` };

  const currency = currencyOf(form, field("purchaseCurrency"));
  const resolver = await moneyResolver(acquiredAt, currency);
  const resolved = resolver.resolveNative(form, field("purchase"), currency);
  if (!resolved) {
    return {
      error: `${label}: enter the price in ${
        isReportingCurrency(currency) ? "USD or JPY" : `${currency}, USD or JPY`
      }.`,
    };
  }
  if (resolver.needsRate) {
    return {
      error:
        `${label}: no ${currency} rate is available for that date. ` +
        "Enter the USD and JPY amounts by hand.",
    };
  }
  const money = resolved.money;
  if (money.usdCents < 0 || money.jpyYen < 0 || (resolved.nativeMinor ?? 0) < 0) {
    return { error: `${label}: price cannot be negative.` };
  }

  const quantityRaw = str(form, field("quantity"));
  const quantity = quantityRaw === "" ? 1 : Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { error: `${label}: quantity must be a whole number of at least 1.` };
  }

  const graderRaw = str(form, field("grader")) || "RAW";
  if (!GRADERS.includes(graderRaw as Grader)) {
    return { error: `${label}: unknown grading company.` };
  }
  const grader = graderRaw as Grader;

  const existingId = optionalStr(form, field("id"));

  return {
    row: {
      ...(existingId ? { id: existingId } : {}),
      grader,
      grade: grader === "RAW" ? null : optionalStr(form, field("grade")),
      certNumber: grader === "RAW" ? null : optionalStr(form, field("certNumber")),
      condition: grader === "RAW" ? optionalStr(form, field("condition")) : null,
      quantity,
      acquiredAt,
      purchaseSource: str(form, field("purchaseSource")) || "OTHER",
      purchaseCurrency: currency,
      purchaseUsdCents: money.usdCents,
      purchaseJpyYen: money.jpyYen,
      purchaseNativeMinor: resolved.nativeMinor,
      purchaseFxNativePerUsd: resolved.nativePerUsd,
      purchaseFxJpyPerUsd: resolver.rate?.jpyPerUsd ?? null,
      purchaseFxDate: resolver.rate?.effectiveDate ?? null,
      purchaseNotes: optionalStr(form, field("purchaseNotes")),
      status: str(form, field("status")) || "OWNED",
    },
  };
}

/** Drops the client-side row id, which is not a column. */
function stripRowId(row: PurchaseInput): Omit<PurchaseInput, "id"> {
  const copy = { ...row };
  delete copy.id;
  return copy;
}

async function collectPurchaseRows(
  form: FormData,
): Promise<{ rows: PurchaseInput[] } | { error: string }> {
  const ids = purchaseRowIds(form);
  if (ids.length === 0) return { error: "Add at least one purchase." };

  const rows: PurchaseInput[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const result = await buildPurchaseRow(form, ids[index], index);
    if ("error" in result) return { error: result.error };
    rows.push(result.row);
  }
  return { rows };
}

export async function createItem(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const identity = parseIdentity(form);
  if (!identity.success) return { error: firstIssue(identity.error) };

  const collected = await collectPurchaseRows(form);
  if ("error" in collected) return { error: collected.error };

  const item = await prisma.item.create({
    data: {
      ...identity.data,
      purchases: {
        create: collected.rows.map((row) => stripRowId(row)),
      },
    } as never,
  });

  revalidatePath("/");
  revalidatePath("/items");
  redirect(`/items/${item.id}`);
}

/**
 * Saves identity plus the full set of rows. Rows carrying an existing id are
 * updated in place so their expenses and sales stay attached; rows without one
 * are new; rows no longer present were removed in the form and are deleted
 * along with everything hanging off them.
 */
export async function updateItem(
  itemId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const identity = parseIdentity(form);
  if (!identity.success) return { error: firstIssue(identity.error) };

  const collected = await collectPurchaseRows(form);
  if ("error" in collected) return { error: collected.error };

  const keptIds = collected.rows.map((r) => r.id).filter(Boolean) as string[];

  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: itemId }, data: identity.data as never });

    await tx.purchase.deleteMany({
      where: { itemId, ...(keptIds.length ? { id: { notIn: keptIds } } : {}) },
    });

    for (const { id, ...row } of collected.rows) {
      if (id) {
        await tx.purchase.update({ where: { id }, data: row as never });
      } else {
        await tx.purchase.create({ data: { ...row, itemId } as never });
      }
    }
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

/** Adds one more copy to an existing card, straight from the item page. */
export async function addPurchase(
  itemId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const collected = await collectPurchaseRows(form);
  if ("error" in collected) return { error: collected.error };

  await prisma.purchase.createMany({
    data: collected.rows.map((row) => ({ ...stripRowId(row), itemId })) as never,
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
  return { ok: true };
}

/**
 * Edits one purchase row in place, from the item page.
 *
 * The whole-item form at /items/[id]/edit can do this too, but it saves every
 * row at once; this exists for correcting a single copy without touching the
 * others. Both share buildPurchaseRow, so validation and FX handling match.
 */
export async function updatePurchase(
  purchaseId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const existing = await prisma.purchase.findUnique({ where: { id: purchaseId } });
  if (!existing) return { error: "That purchase no longer exists." };

  const collected = await collectPurchaseRows(form);
  if ("error" in collected) return { error: collected.error };

  const row = collected.rows[0];
  if (!row) return { error: "Nothing to save." };

  await prisma.purchase.update({
    where: { id: purchaseId },
    data: stripRowId(row) as never,
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${existing.itemId}`);
  return { ok: true };
}

export async function deletePurchase(purchaseId: string): Promise<void> {
  const purchase = await prisma.purchase.delete({ where: { id: purchaseId } });
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${purchase.itemId}`);
}

/** Status changes are frequent enough to deserve a one-click path. */
export async function setPurchaseStatus(
  purchaseId: string,
  status: string,
): Promise<void> {
  if (!ITEM_STATUSES.includes(status as (typeof ITEM_STATUSES)[number])) return;
  const purchase = await prisma.purchase.update({
    where: { id: purchaseId },
    data: { status: status as never },
  });
  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${purchase.itemId}`);
}

// ---------------------------------------------------------------------------
// Expenses — itemId null means a general (non-item) expense.
// ---------------------------------------------------------------------------

const expenseSchema = z.object({
  purchaseId: z.string().nullable(),
  category: z.enum(EXPENSE_CATEGORIES as [string, ...string[]]),
  description: z.string().min(1, "Description is required."),
  amountUsdCents: z.number().int(),
  amountJpyYen: z.number().int(),
  currency: z.enum(["USD", "JPY"]),
  incurredAt: z.date({ message: "A valid date is required." }),
  vendor: z.string().nullable(),
  notes: z.string().nullable(),
});

/**
 * Parses an expense form into database columns. Shared by create and update so
 * the two cannot drift apart in validation or FX handling.
 *
 * The rate is resolved from the submitted date every time, so editing an
 * expense's date re-converts it at the rate for the new date rather than
 * leaving a figure converted at the old one.
 */
async function parseExpenseForm(
  form: FormData,
): Promise<{ data: Record<string, unknown> } | { error: string }> {
  const incurredAt = parseDateInput(str(form, "incurredAt"));
  const currency = currencyOf(form);
  const resolver = await moneyResolver(incurredAt ?? new Date(), currency);
  const amount = resolver.resolve(form, "amount", currency);

  if (!amount) return { error: "Enter the amount in USD or JPY." };
  if (amount.usdCents === 0 && amount.jpyYen === 0) {
    return { error: "Amount cannot be zero." };
  }

  const parsed = expenseSchema.safeParse({
    purchaseId: optionalStr(form, "purchaseId"),
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

  return { data: { ...parsed.data, ...fxColumns(resolver) } };
}

function revalidateExpenseViews() {
  revalidatePath("/");
  revalidatePath("/expenses");
  revalidatePath("/items", "layout");
}

export async function createExpense(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = await parseExpenseForm(form);
  if ("error" in parsed) return { error: parsed.error };

  await prisma.expense.create({ data: parsed.data as never });

  revalidateExpenseViews();
  return { ok: true };
}

/**
 * Edits an existing expense. Which purchase it belongs to (or that it is a
 * general expense) is deliberately left alone — the form does not offer to
 * move it, so an absent purchaseId must not be read as "detach".
 */
export async function updateExpense(
  expenseId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const existing = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!existing) return { error: "That expense no longer exists." };

  const parsed = await parseExpenseForm(form);
  if ("error" in parsed) return { error: parsed.error };

  const fields = { ...(parsed.data as Record<string, unknown>) };
  delete fields.purchaseId;
  await prisma.expense.update({ where: { id: expenseId }, data: fields as never });

  revalidateExpenseViews();
  return { ok: true };
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await prisma.expense.delete({ where: { id: expenseId } });
  revalidateExpenseViews();
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export async function createSale(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const purchaseId = str(form, "purchaseId");
  const soldAt = parseDateInput(str(form, "soldAt"));
  if (!purchaseId) return { error: "Missing purchase." };
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
      purchaseId,
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

  // Recording a sale is what marks that copy sold; no reason to do it twice.
  const purchase = await prisma.purchase.update({
    where: { id: purchaseId },
    data: { status: "SOLD" },
  });

  revalidatePath("/");
  revalidatePath("/items");
  revalidatePath(`/items/${purchase.itemId}`);
  return { ok: true };
}

export async function deleteSale(saleId: string): Promise<void> {
  const sale = await prisma.sale.delete({ where: { id: saleId } });

  const remaining = await prisma.sale.count({ where: { purchaseId: sale.purchaseId } });
  const purchase = remaining === 0
    ? await prisma.purchase.update({ where: { id: sale.purchaseId }, data: { status: "OWNED" } })
    : await prisma.purchase.findUnique({ where: { id: sale.purchaseId } });

  revalidatePath("/");
  revalidatePath("/items");
  if (purchase) revalidatePath(`/items/${purchase.itemId}`);
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
