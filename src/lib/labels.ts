import type {
  ExpenseCategory,
  Grader,
  ItemStatus,
  ItemType,
  Marketplace,
} from "@prisma/client";

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  CARD: "Card",
  MANGA: "Manga",
};

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  OWNED: "In collection",
  LISTED: "Listed",
  SOLD: "Sold",
  RETURNED: "Returned",
  LOST: "Lost / damaged",
};

export const GRADER_LABELS: Record<Grader, string> = {
  RAW: "Raw (ungraded)",
  PSA: "PSA",
  BGS: "BGS",
  CGC: "CGC",
  SGC: "SGC",
  TAG: "TAG",
  ACE: "ACE",
  OTHER: "Other grader",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  SHIPPING_IN: "Shipping in",
  SHIPPING_OUT: "Shipping out",
  GRADING: "Grading",
  SUPPLIES: "Supplies",
  PLATFORM_FEE: "Platform fee",
  TAX: "Tax",
  TRAVEL: "Travel",
  SUBSCRIPTION: "Subscription",
  STORAGE: "Storage",
  AUTHENTICATION: "Authentication",
  OTHER: "Other",
};

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  EBAY: "eBay",
  TCGPLAYER: "TCGplayer",
  WHATNOT: "Whatnot",
  MERCARI: "Mercari",
  AMAZON: "Amazon",
  FACEBOOK: "Facebook",
  LOCAL: "Local / in person",
  SHOW: "Show / convention",
  OTHER: "Other",
};

export const ITEM_TYPES = Object.keys(ITEM_TYPE_LABELS) as ItemType[];
export const ITEM_STATUSES = Object.keys(ITEM_STATUS_LABELS) as ItemStatus[];
export const GRADERS = Object.keys(GRADER_LABELS) as Grader[];
export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];
export const MARKETPLACES = Object.keys(MARKETPLACE_LABELS) as Marketplace[];

/** Short slab-style descriptor, e.g. "PSA 10" or "Raw · NM". */
export function gradeLabel(
  grader: Grader,
  grade: string | null,
  condition?: string | null,
): string {
  if (grader === "RAW") return condition ? `Raw · ${condition}` : "Raw";
  const company = GRADER_LABELS[grader];
  return grade ? `${company} ${grade}` : company;
}
