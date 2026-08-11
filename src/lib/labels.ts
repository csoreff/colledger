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
  ARS: "ARS",
  OTHER: "Other grader",
};

/// Graders whose scale tops out above a plain 10. ARS awards 10+ above its 10.
export const GRADERS_WITH_PLUS_GRADE: Grader[] = ["ARS"];

export function maxGradeLabel(grader: Grader): string | null {
  if (grader === "RAW" || grader === "OTHER") return null;
  return GRADERS_WITH_PLUS_GRADE.includes(grader) ? "10+" : "10";
}

const COMMON_GRADES = [
  "10", "9.9", "9.8", "9.6", "9.5", "9", "8.5", "8", "7.5", "7", "6.5", "6",
  "5.5", "5", "4.5", "4", "3.5", "3", "2.5", "2", "1.5", "1",
];

/// Suggestions only — the grade field stays free text, since scales vary.
export function gradeOptionsFor(grader: Grader): string[] {
  if (grader === "RAW") return [];
  return GRADERS_WITH_PLUS_GRADE.includes(grader)
    ? ["10+", ...COMMON_GRADES]
    : COMMON_GRADES;
}

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
