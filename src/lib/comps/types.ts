import type { Grader, ItemType } from "@prisma/client";

export type CompQuery = {
  /** Free text, e.g. "Chainsaw Man vol 1 first print" or "Charizard base set". */
  query: string;
  itemType?: ItemType | null;
  /** null = any; RAW = ungraded only; otherwise restrict to that grading company. */
  grader?: Grader | null;
  /** e.g. "10". Only meaningful alongside a grader. */
  grade?: string | null;
  limit?: number;
};

export type CompResult = {
  externalId?: string | null;
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  soldAt?: Date | null;

  /** Best available price the buyer paid, in cents. */
  salePriceCents: number;
  /** Asking price, when it differs from what was actually paid. */
  listedPriceCents?: number | null;
  shippingCents?: number | null;
  currency?: string;

  wasBestOffer?: boolean;
  /**
   * TRUE  -> salePriceCents is the real transacted amount.
   * FALSE -> the listing closed via Best Offer and the provider could not see
   *          the accepted amount, so salePriceCents is only the asking price
   *          and should be treated as an upper bound.
   */
  priceIsConfirmed: boolean;

  grader?: Grader | null;
  grade?: string | null;
  condition?: string | null;
};

export type CompProviderResponse = {
  results: CompResult[];
  /** Non-fatal problem worth showing the user (e.g. degraded price accuracy). */
  warning?: string | null;
};

export interface CompProvider {
  /** Stable id persisted on cached rows. */
  readonly id: string;
  readonly label: string;
  /** Whether this provider resolves true accepted Best Offer prices. */
  readonly resolvesBestOffer: boolean;
  /** Why the provider can't run right now, or null when it's good to go. */
  unavailableReason(): string | null;
  search(query: CompQuery): Promise<CompProviderResponse>;
}

/** Thrown for problems worth showing the user verbatim. */
export class CompProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompProviderError";
  }
}
