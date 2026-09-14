/**
 * The public collection page — the only path in this application that returns
 * ledger data to a request carrying no credentials.
 *
 * Everything else is gated by `src/lib/tenant.ts` (sessions) or
 * `src/lib/api/http.ts` (API keys). This file is the single exception, so it is
 * written to be paranoid rather than convenient:
 *
 *  1. **Allowlist, never `include`.** Every query below spells out the exact
 *     columns it wants. A `select` that names fields cannot start leaking a new
 *     one when the schema grows; an `include` silently would. Nothing here may
 *     become a spread of a Prisma row.
 *  2. **Money is unreachable, not filtered.** No amount, fee, rate or profit is
 *     selected at any depth, so there is no formatting step that could
 *     accidentally render one. Expenses and sales are never queried at all.
 *  3. **Held copies only.** A sold copy is excluded at the database level, not
 *     hidden in the view, and an item whose copies are all sold disappears
 *     entirely rather than showing as an empty card.
 *  4. **Disabled is indistinguishable from absent.** A private or unknown slug
 *     both yield null, so the page 404s identically and the URL space cannot be
 *     probed to discover which accounts exist.
 */
import type { Grader, ItemType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADERS as GRADER_VALUES, ITEM_TYPES as ITEM_TYPE_VALUES } from "@/lib/labels";

/**
 * Statuses that mean "I still have this".
 *
 * LISTED counts as held: the copy is up for sale but has not left. SOLD,
 * RETURNED and LOST are all gone, and none of them belong on a page describing
 * a current collection.
 */
export const HELD_STATUSES = ["OWNED", "LISTED"] as const;

/** One copy, reduced to what a stranger may know about it. */
export type ShowcaseCopy = {
  id: string;
  grader: Grader;
  grade: string | null;
  certNumber: string | null;
  condition: string | null;
  quantity: number;
};

/** One card or volume, with the held copies of it. */
export type ShowcaseItem = {
  id: string;
  type: ItemType;
  title: string;
  setName: string | null;
  number: string | null;
  variant: string | null;
  language: string;
  imageUrl: string | null;
  copies: ShowcaseCopy[];
  /** Total physical pieces held, summing each copy's quantity. */
  heldCount: number;
};

/**
 * What a visitor may narrow the page by.
 *
 * Every one of these corresponds to something the page already displays, and
 * that is a hard rule rather than a coincidence. **A filter discloses data even
 * when the field is never rendered**: allowing `?source=YAHOO_AUCTIONS` would
 * let anyone learn where each card was bought purely from which ones came back,
 * and a price range would do the same for value. So the filterable set can
 * never be wider than the visible set.
 */
export type ShowcaseFilters = {
  q?: string;
  type?: string;
  grader?: string;
  language?: string;
  sort?: string;
};

/** Values actually present in this collection, for building the dropdowns. */
export type ShowcaseFacets = {
  types: ItemType[];
  graders: Grader[];
  languages: string[];
};

export type Showcase = {
  /** Display name for the page. Never the owner's email address. */
  ownerName: string;
  slug: string;
  items: ShowcaseItem[];
  /** Counts for the current filter. */
  totals: { titles: number; cards: number };
  /** Counts for the whole collection, so the page can say "12 of 205". */
  unfiltered: { titles: number; cards: number };
  facets: ShowcaseFacets;
  filters: ShowcaseFilters;
  isFiltered: boolean;
};

export const SHOWCASE_SORTS = ["title", "title-desc", "copies", "set"] as const;
export type ShowcaseSort = (typeof SHOWCASE_SORTS)[number];

export const SHOWCASE_SORT_LABELS: Record<ShowcaseSort, string> = {
  title: "Title A–Z",
  "title-desc": "Title Z–A",
  set: "Set",
  copies: "Most copies",
};

/**
 * Loads a public collection, or null when there isn't one to show.
 *
 * Deliberately *not* exported through the REST API or any server action: a
 * caller reaching this has already been routed to the public page.
 */
export async function getShowcase(
  slug: string,
  filters: ShowcaseFilters = {},
): Promise<Showcase | null> {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return null;

  const owner = await prisma.user.findFirst({
    // Both flags are part of the lookup rather than checked afterwards, so a
    // disabled showcase can never be loaded and then conditionally hidden.
    where: { publicSlug: trimmed, publicShowcase: true, isActive: true },
    select: { id: true, name: true, publicSlug: true },
  });
  if (!owner?.publicSlug) return null;

  const heldCopy = { status: { in: [...HELD_STATUSES] } };

  // Only cards with at least one held copy. Without this, an item whose every
  // copy has sold would render as a title with nothing under it.
  const base = { userId: owner.id, purchases: { some: heldCopy } };

  // --- Narrowing, strictly within what the page shows -------------------
  const where: Record<string, unknown> = { ...base };

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { setName: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } },
      { variant: { contains: q, mode: "insensitive" } },
      // Cert numbers are printed on the slab and shown on this page, so
      // searching them reveals nothing the visitor cannot already read.
      { purchases: { some: { ...heldCopy, certNumber: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const type = filters.type?.trim().toUpperCase();
  if (type && ITEM_TYPE_VALUES.includes(type as ItemType)) where.type = type;

  const language = filters.language?.trim();
  if (language) where.language = { equals: language, mode: "insensitive" };

  const grader = filters.grader?.trim().toUpperCase();
  if (grader && GRADER_VALUES.includes(grader as Grader)) {
    // Matched against held copies only, so a grade that exists solely on a sold
    // copy cannot be used to infer that the sold copy exists.
    where.purchases = { some: { ...heldCopy, grader: grader as Grader } };
  }

  const sort: ShowcaseSort = SHOWCASE_SORTS.includes(filters.sort as ShowcaseSort)
    ? (filters.sort as ShowcaseSort)
    : "title";

  const rows = await prisma.item.findMany({
    where: where as never,
    select: {
      id: true,
      type: true,
      title: true,
      setName: true,
      number: true,
      variant: true,
      language: true,
      imageUrl: true,
      // NOT selected, and each for a reason: `notes` and `compQuery` are the
      // owner's private working notes; `userId` identifies the account;
      // `createdAt`/`updatedAt` leak activity patterns.
      purchases: {
        where: { status: { in: [...HELD_STATUSES] } },
        select: {
          id: true,
          grader: true,
          grade: true,
          certNumber: true,
          condition: true,
          quantity: true,
          // NOT selected: every purchase*/fx* money column, acquiredAt,
          // purchaseSource, purchaseNotes, notes, status, externalRef.
          // A grading cert is public information printed on the slab; what was
          // paid for it is not.
        },
        orderBy: [{ grader: "asc" }, { id: "asc" }],
      },
    },
    // "Most copies" counts held pieces, which is a JS rollup, so that one sort
    // is applied after the fetch; the rest the database can do.
    orderBy:
      sort === "title-desc"
        ? [{ title: "desc" }, { id: "asc" }]
        : sort === "set"
          ? [{ setName: "asc" }, { number: "asc" }, { title: "asc" }]
          : [{ title: "asc" }, { id: "asc" }],
  });

  // Built field by field rather than spreading the row. The select above is
  // already an allowlist, but a spread would mean a column added to that select
  // in future silently reaches the page too — and it would ship `purchases`
  // alongside `copies`, sending the same data twice.
  const items: ShowcaseItem[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    setName: row.setName,
    number: row.number,
    variant: row.variant,
    language: row.language,
    imageUrl: row.imageUrl,
    copies: row.purchases.map((copy) => ({
      id: copy.id,
      grader: copy.grader,
      grade: copy.grade,
      certNumber: copy.certNumber,
      condition: copy.condition,
      quantity: copy.quantity,
    })),
    heldCount: row.purchases.reduce((sum, copy) => sum + copy.quantity, 0),
  }));

  if (sort === "copies") {
    items.sort((a, b) => b.heldCount - a.heldCount || a.title.localeCompare(b.title));
  }

  // Facets are drawn from the whole held collection, not the filtered result:
  // the dropdowns must keep offering the other choices after one is picked,
  // otherwise selecting a filter would erase the way back out of it.
  const [heldItems, graderRows, languageRows, typeRows] = await Promise.all([
    prisma.item.findMany({
      where: base,
      select: { purchases: { where: heldCopy, select: { quantity: true } } },
    }),
    prisma.purchase.findMany({
      where: { userId: owner.id, ...heldCopy },
      select: { grader: true },
      distinct: ["grader"],
    }),
    prisma.item.findMany({
      where: base,
      select: { language: true },
      distinct: ["language"],
      orderBy: { language: "asc" },
    }),
    prisma.item.findMany({
      where: base,
      select: { type: true },
      distinct: ["type"],
    }),
  ]);

  const isFiltered = Boolean(q || type || language || grader);

  return {
    // Fall back to the slug, never the email — the page must not publish an
    // address that can be harvested.
    ownerName: owner.name?.trim() || owner.publicSlug,
    slug: owner.publicSlug,
    items,
    totals: {
      titles: items.length,
      cards: items.reduce((sum, item) => sum + item.heldCount, 0),
    },
    unfiltered: {
      titles: heldItems.length,
      cards: heldItems.reduce(
        (sum, item) => sum + item.purchases.reduce((n, c) => n + c.quantity, 0),
        0,
      ),
    },
    facets: {
      types: typeRows.map((r) => r.type),
      graders: graderRows.map((r) => r.grader),
      languages: languageRows.map((r) => r.language),
    },
    filters: { q, type, grader, language, sort },
    isFiltered,
  };
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

/** Lowercase letters, digits and single hyphens; 3–40 characters. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/**
 * Reserved words that would collide with a real route or read as official.
 * `showcase` itself is here so `/showcase/showcase` can never exist.
 */
const RESERVED = new Set([
  "admin", "api", "settings", "login", "register", "logout", "items", "expenses",
  "comps", "showcase", "new", "edit", "public", "static", "assets", "support",
  "help", "about", "terms", "privacy", "root", "system", "collectors-ledger",
]);

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function validateSlug(slug: string): string | null {
  if (slug.length < 3) return "Use at least 3 characters.";
  if (!SLUG_PATTERN.test(slug)) {
    return "Use lowercase letters, numbers and hyphens only, starting and ending with a letter or number.";
  }
  if (RESERVED.has(slug)) return "That name is reserved. Pick another.";
  return null;
}

/**
 * Invents a free slug for someone turning the page on for the first time.
 *
 * Built from the display name where there is one, otherwise a neutral word —
 * never from the email, since a slug is public and an address is not.
 */
export async function generateSlug(name: string | null): Promise<string> {
  const base = normalizeSlug(name ?? "") || "collector";
  const seed = base.length >= 3 ? base : "collector";

  for (let attempt = 0; attempt < 25; attempt += 1) {
    // First choice is the bare name; after that, a short random suffix rather
    // than a counter, which would let anyone guess neighbouring slugs.
    const candidate =
      attempt === 0
        ? seed
        : `${seed}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 40);

    if (validateSlug(candidate)) continue;
    const taken = await prisma.user.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  // Vanishingly unlikely; a timestamp suffix is guaranteed to be free.
  return `collector-${Date.now().toString(36)}`;
}
