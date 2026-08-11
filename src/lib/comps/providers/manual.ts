import type { CompProvider, CompProviderResponse } from "../types";

/**
 * The always-available fallback: no upstream call at all. The search row is
 * created empty and you fill it with comps you looked up yourself. Useful both
 * as a standalone mode and as the backstop when a live provider is unavailable.
 */
export class ManualCompProvider implements CompProvider {
  readonly id = "manual";
  readonly label = "Manual entry";
  readonly resolvesBestOffer = true; // you type the true price in yourself

  unavailableReason(): string | null {
    return null;
  }

  async search(): Promise<CompProviderResponse> {
    return {
      results: [],
      warning:
        "Manual mode: nothing is fetched automatically. Add each sold comp below " +
        "with the price it actually closed at.",
    };
  }
}
