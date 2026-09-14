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

export type Showcase = {
  /** Display name for the page. Never the owner's email address. */
  ownerName: string;
  slug: string;
  items: ShowcaseItem[];
  totals: { titles: number; cards: number };
};

/**
 * Loads a public collection, or null when there isn't one to show.
 *
 * Deliberately *not* exported through the REST API or any server action: a
 * caller reaching this has already been routed to the public page.
 */
export async function getShowcase(slug: string): Promise<Showcase | null> {
  const trimmed = slug.trim().toLowerCase();
  if (!trimmed) return null;

  const owner = await prisma.user.findFirst({
    // Both flags are part of the lookup rather than checked afterwards, so a
    // disabled showcase can never be loaded and then conditionally hidden.
    where: { publicSlug: trimmed, publicShowcase: true, isActive: true },
    select: { id: true, name: true, publicSlug: true },
  });
  if (!owner?.publicSlug) return null;

  const rows = await prisma.item.findMany({
    where: {
      userId: owner.id,
      // Only cards with at least one held copy. Without this, an item whose
      // every copy has sold would render as a title with nothing under it.
      purchases: { some: { status: { in: [...HELD_STATUSES] } } },
    },
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
    orderBy: [{ title: "asc" }, { id: "asc" }],
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
