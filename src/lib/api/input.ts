/**
 * Turning JSON payloads into ledger columns.
 *
 * The web forms and this API both have to obey the same money rules — store
 * both currencies, at the rate for the record's own transaction date, never
 * multiplying yen by 100 — so the conversion lives here once and both the
 * create and update routes go through it.
 *
 * An amount can be given three ways, in decreasing order of precedence:
 *
 *   { "usdCents": 78000, "jpyYen": 123396 }  both sides stated outright
 *   { "currency": "JPY", "minor": 68000 }    minor units of one currency
 *   { "currency": "USD", "amount": 780.00 }  major units of one currency
 *
 * Stating both sides wins, and skips FX entirely. That is the escape hatch for
 * importing historical records whose real conversion is already known: a
 * marketplace's own rate beats a mid-market one, and re-deriving it from
 * today's published rate would quietly change a settled figure.
 */
import { z } from "zod";
import type { Currency } from "@prisma/client";
import {
  CURRENCIES,
  isReportingCurrency,
  makeMoney,
  minorUnits,
  nativeToMoney,
  type Money,
} from "@/lib/currency";
import { FxUnavailableError, getRateForDate, type FxLookup } from "@/lib/fx";
import {
  EXPENSE_CATEGORIES,
  GRADERS,
  ITEM_STATUSES,
  ITEM_TYPES,
  MARKETPLACES,
} from "@/lib/labels";

const currencyEnum = z.enum(CURRENCIES as [Currency, ...Currency[]]);

/**
 * A date as `YYYY-MM-DD` or a full ISO timestamp.
 *
 * Parsed at local noon when only a day is given, matching `parseDateInput` in
 * the web forms — a bare date parsed as UTC midnight lands on the previous day
 * for anyone west of Greenwich, which would pull the wrong FX rate.
 */
export const dateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Expected a date like 2026-03-14.")
  .transform((value) => {
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!dayOnly) return new Date(value);
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  });

export const moneySchema = z
  .object({
    currency: currencyEnum.default("USD"),
    /** Major units: dollars, pounds, or yen. */
    amount: z.number().finite().optional(),
    /** Minor units: cents, pence, or whole yen. */
    minor: z.number().int().optional(),
    usdCents: z.number().int().optional(),
    jpyYen: z.number().int().optional(),
  })
  .refine(
    (value) =>
      value.amount !== undefined ||
      value.minor !== undefined ||
      (value.usdCents !== undefined && value.jpyYen !== undefined),
    "Give `amount`, or `minor`, or both `usdCents` and `jpyYen`.",
  );

export type MoneyInput = z.infer<typeof moneySchema>;

export type ResolvedMoney = {
  money: Money;
  currency: Currency;
  /** Minor units of the transaction currency; only kept for GBP/AUD. */
  nativeMinor: number | null;
  nativePerUsd: number | null;
  fxJpyPerUsd: number | null;
  fxDate: Date | null;
};

/** Everything needed to convert amounts dated a particular day. */
export async function rateFor(date: Date, currency: Currency): Promise<FxLookup | null> {
  try {
    return await getRateForDate(date, currency);
  } catch (error) {
    if (error instanceof FxUnavailableError) return null;
    throw error;
  }
}

function toMinor(input: MoneyInput): number | null {
  if (input.minor !== undefined) return input.minor;
  if (input.amount !== undefined) {
    return Math.round(input.amount * minorUnits(input.currency));
  }
  return null;
}

/**
 * Completes a money pair for one amount on one date.
 *
 * Returns a message instead of throwing when the pair can't be completed —
 * an import of a hundred rows should report which row was unconvertible, not
 * blow up the whole request.
 */
export async function resolveMoney(
  input: MoneyInput,
  date: Date,
  label: string,
): Promise<{ ok: true; value: ResolvedMoney } | { ok: false; error: string }> {
  const currency = input.currency;
  const bothSidesGiven = input.usdCents !== undefined && input.jpyYen !== undefined;

  const rate = await rateFor(date, currency);
  const nativeMinor = toMinor(input);

  // Caller stated both sides: take them verbatim, and record the rate only as
  // provenance if we happen to have one.
  if (bothSidesGiven) {
    return {
      ok: true,
      value: {
        money: { usdCents: input.usdCents!, jpyYen: input.jpyYen! },
        currency,
        nativeMinor: isReportingCurrency(currency) ? null : nativeMinor,
        nativePerUsd: rate?.rates?.[currency] ?? null,
        fxJpyPerUsd: rate?.jpyPerUsd ?? null,
        fxDate: rate?.effectiveDate ?? null,
      },
    };
  }

  if (nativeMinor === null) {
    return { ok: false, error: `${label}: no amount given.` };
  }

  if (!rate) {
    return {
      ok: false,
      error:
        `${label}: no ${currency} exchange rate is published for that date. ` +
        "Send `usdCents` and `jpyYen` together to record the figures directly.",
    };
  }

  if (isReportingCurrency(currency)) {
    const side =
      currency === "JPY" ? { jpyYen: nativeMinor } : { usdCents: nativeMinor };
    return {
      ok: true,
      value: {
        money: makeMoney(side, rate.jpyPerUsd, currency),
        currency,
        // USD and JPY are the reporting pair already; there is no separate
        // native figure to keep, and storing one would just duplicate a column.
        nativeMinor: null,
        nativePerUsd: currency === "JPY" ? rate.jpyPerUsd : 1,
        fxJpyPerUsd: rate.jpyPerUsd,
        fxDate: rate.effectiveDate,
      },
    };
  }

  const money = nativeToMoney({ minor: nativeMinor, currency }, rate.rates);
  if (!money) {
    return {
      ok: false,
      error: `${label}: no ${currency} rate available for that date.`,
    };
  }

  return {
    ok: true,
    value: {
      money,
      currency,
      nativeMinor,
      nativePerUsd: rate.rates[currency] ?? null,
      fxJpyPerUsd: rate.jpyPerUsd,
      fxDate: rate.effectiveDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Resource schemas
// ---------------------------------------------------------------------------

const graderEnum = z.enum(GRADERS as [string, ...string[]]);
const statusEnum = z.enum(ITEM_STATUSES as [string, ...string[]]);
const marketplaceEnum = z.enum(MARKETPLACES as [string, ...string[]]);
const categoryEnum = z.enum(EXPENSE_CATEGORIES as [string, ...string[]]);

export const itemIdentitySchema = z.object({
  externalRef: z.string().min(1).max(200).nullish(),
  type: z.enum(ITEM_TYPES as [string, ...string[]]),
  title: z.string().min(1, "title is required."),
  setName: z.string().nullish(),
  number: z.string().nullish(),
  variant: z.string().nullish(),
  language: z.string().min(1).default("English"),
  imageUrl: z.string().url().nullish().or(z.literal("")),
  notes: z.string().nullish(),
  compQuery: z.string().nullish(),
});

export const purchaseSchema = z.object({
  externalRef: z.string().min(1).max(200).nullish(),
  grader: graderEnum.default("RAW"),
  grade: z.string().nullish(),
  certNumber: z.string().nullish(),
  condition: z.string().nullish(),
  quantity: z.number().int().min(1).default(1),
  acquiredAt: dateSchema,
  purchaseSource: marketplaceEnum.default("OTHER"),
  /** Total paid for the row, not per unit. */
  price: moneySchema,
  purchaseNotes: z.string().nullish(),
  status: statusEnum.default("OWNED"),
  notes: z.string().nullish(),
});

export const expenseSchema = z.object({
  externalRef: z.string().min(1).max(200).nullish(),
  /** Omit for a general (overhead) expense. */
  purchaseId: z.string().nullish(),
  purchaseRef: z.string().nullish(),
  category: categoryEnum,
  description: z.string().min(1, "description is required."),
  incurredAt: dateSchema,
  amount: moneySchema,
  vendor: z.string().nullish(),
  notes: z.string().nullish(),
});

export const saleSchema = z.object({
  externalRef: z.string().min(1).max(200).nullish(),
  purchaseId: z.string().nullish(),
  purchaseRef: z.string().nullish(),
  soldAt: dateSchema,
  platform: marketplaceEnum.default("EBAY"),
  quantity: z.number().int().min(1).default(1),
  grossPrice: moneySchema,
  shippingCollected: moneySchema.optional(),
  platformFee: moneySchema.optional(),
  shippingCost: moneySchema.optional(),
  otherFee: moneySchema.optional(),
  wasBestOffer: z.boolean().default(false),
  listedPrice: moneySchema.optional(),
  buyer: z.string().nullish(),
  notes: z.string().nullish(),
});

/** An item plus the copies of it, as one payload. */
export const itemWithPurchasesSchema = itemIdentitySchema.extend({
  purchases: z.array(purchaseSchema).default([]),
});

/** Empty strings from a CSV-ish source mean "not set", not a value. */
export function blankToNull<T extends string | null | undefined>(value: T): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}
