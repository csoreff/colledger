import type { Currency, Grader } from "@prisma/client";
import { GRADERS_WITH_PLUS_GRADE } from "@/lib/labels";
import {
  CompProviderError,
  type CompProvider,
  type CompProviderResponse,
  type CompQuery,
  type CompResult,
  type ProviderAmount,
} from "../types";

/**
 * eBay Marketplace Insights API (v1_beta).
 *
 * This is the only route to genuine sold-price data, and critically it reports
 * `lastSoldPrice` — the amount actually transacted. For a listing that closed
 * via an accepted Best Offer, that is the accepted offer, not the asking price.
 * That is why every result from this provider is marked priceIsConfirmed.
 *
 * Access requires eBay to grant the `buy.marketplace.insights` scope to your
 * application; it is not enabled by default on a new developer keyset.
 */

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search";
const SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
    cache: "no-store",
  });

  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;

  if (!res.ok || !body?.access_token) {
    throw new CompProviderError(
      `eBay OAuth failed (${res.status}). ${body?.error_description ?? ""}`.trim() +
        " Confirm your keyset has the buy.marketplace.insights scope granted.",
    );
  }

  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000,
  };
  return cachedToken.token;
}

/** Builds the eBay `filter` parameter. Sold data only goes back 90 days. */
function buildFilter(): string {
  const ninetyDaysAgo = new Date(Date.now() - 89 * 24 * 60 * 60 * 1000).toISOString();
  return `lastSoldDate:[${ninetyDaysAgo}..]`;
}

/**
 * eBay has no "graded" facet, so grading terms are folded into the keyword
 * query the way a person would type them into the search box.
 */
function buildKeywords(query: CompQuery): string {
  const parts = [query.query.trim()];
  if (query.grader && query.grader !== "RAW") {
    parts.push(query.grader);
    if (query.grade) parts.push(query.grade);
  }
  return parts.filter(Boolean).join(" ");
}

// Grades run 1–10 and carry one optional decimal. CGC in particular uses 9.8
// and 9.6, so this must not be limited to half-point steps.
const GRADE_NUMBER = String.raw`(10(?:\.0)?|[1-9](?:\.\d)?)`;
// ARS sits a 10+ above its 10, so the plus must be tried before a bare 10 or
// "ARS 10+" would capture just "10".
const GRADE_NUMBER_WITH_PLUS = String.raw`(10\+|10(?:\.0)?|[1-9](?:\.\d)?)`;

const GRADER_PATTERNS: Array<{ grader: Grader; re: RegExp }> = (
  ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE", "ARS"] as const
).map((grader) => {
  const number = GRADERS_WITH_PLUS_GRADE.includes(grader)
    ? GRADE_NUMBER_WITH_PLUS
    : GRADE_NUMBER;
  return {
    grader,
    re: new RegExp(String.raw`\b${grader}\s*${number}(?![\d.])`, "i"),
  };
});

/** Best-effort grade extraction from a listing title. */
export function inferGradeFromTitle(title: string): { grader: Grader; grade: string | null } {
  for (const { grader, re } of GRADER_PATTERNS) {
    const match = title.match(re);
    if (match) return { grader, grade: match[1] ?? null };
  }
  return { grader: "RAW", grade: null };
}

/**
 * eBay reports prices as a decimal string plus a currency code. JPY has no
 * subunit, so it must not be scaled by 100 the way USD is.
 */
function toProviderAmount(
  value: unknown,
  currencyCode: unknown,
): ProviderAmount | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(num)) return null;

  const currency: Currency = String(currencyCode).toUpperCase() === "JPY" ? "JPY" : "USD";
  return {
    amountMinor: currency === "JPY" ? Math.round(num) : Math.round(num * 100),
    currency,
  };
}

// The v1_beta response shape. Parsed defensively — unknown/renamed fields are
// skipped rather than allowed to throw.
type EbayItemSale = {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  condition?: string;
  lastSoldDate?: string;
  lastSoldPrice?: { value?: string; currency?: string };
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl?: string }>;
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>;
};

export class EbayApiCompProvider implements CompProvider {
  readonly id = "ebay-api";
  readonly label = "eBay Marketplace Insights API";
  readonly resolvesBestOffer = true;

  private clientId = process.env.EBAY_CLIENT_ID ?? "";
  private clientSecret = process.env.EBAY_CLIENT_SECRET ?? "";
  private marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

  unavailableReason(): string | null {
    if (!this.clientId || !this.clientSecret) {
      return "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set in .env.";
    }
    return null;
  }

  async search(query: CompQuery): Promise<CompProviderResponse> {
    const blocked = this.unavailableReason();
    if (blocked) throw new CompProviderError(blocked);

    const token = await getAccessToken(this.clientId, this.clientSecret);

    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", buildKeywords(query));
    url.searchParams.set("filter", buildFilter());
    url.searchParams.set("limit", String(Math.min(query.limit ?? 50, 200)));

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 403) {
      throw new CompProviderError(
        "eBay returned 403 for Marketplace Insights. The keyset authenticated fine " +
          "but is not approved for sold data — you need to request the " +
          "buy.marketplace.insights scope from eBay.",
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new CompProviderError(
        `eBay Marketplace Insights returned ${res.status}. ${detail.slice(0, 300)}`,
      );
    }

    const payload = (await res.json()) as { itemSales?: EbayItemSale[] };
    const sales = Array.isArray(payload.itemSales) ? payload.itemSales : [];

    const results: CompResult[] = [];
    for (const sale of sales) {
      const salePrice = toProviderAmount(
        sale.lastSoldPrice?.value,
        sale.lastSoldPrice?.currency,
      );
      if (salePrice === null) continue; // no price, no comp

      const title = sale.title ?? "(untitled listing)";
      const inferred = inferGradeFromTitle(title);
      const soldAt = sale.lastSoldDate ? new Date(sale.lastSoldDate) : null;

      results.push({
        externalId: sale.itemId ?? null,
        title,
        url: sale.itemWebUrl ?? null,
        imageUrl: sale.image?.imageUrl ?? sale.thumbnailImages?.[0]?.imageUrl ?? null,
        soldAt: soldAt && !Number.isNaN(soldAt.getTime()) ? soldAt : null,
        salePrice,
        listedPrice: null,
        shipping: toProviderAmount(
          sale.shippingOptions?.[0]?.shippingCost?.value,
          sale.shippingOptions?.[0]?.shippingCost?.currency ?? salePrice.currency,
        ),
        // lastSoldPrice is the transacted amount, so an accepted Best Offer is
        // already reflected here. We cannot tell *whether* it was an offer, but
        // the number is the true one either way.
        wasBestOffer: false,
        priceIsConfirmed: true,
        grader: inferred.grader,
        grade: inferred.grade,
        condition: sale.condition ?? null,
      });
    }

    return {
      results: filterByGrade(results, query),
      warning: null,
    };
  }
}

/** Applies the grader/grade filter client-side, since eBay has no such facet. */
export function filterByGrade(results: CompResult[], query: CompQuery): CompResult[] {
  if (!query.grader) return results;
  return results.filter((r) => {
    if (r.grader !== query.grader) return false;
    if (query.grade && r.grade !== query.grade) return false;
    return true;
  });
}
