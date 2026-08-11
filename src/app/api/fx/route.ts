import { NextResponse } from "next/server";
import { getRateForDate, FxUnavailableError } from "@/lib/fx";
import { parseDateInput, toDateInputValue } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Feeds the live USD<->JPY conversion in the entry forms.
 * GET /api/fx?date=YYYY-MM-DD
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = parseDateInput(searchParams.get("date")) ?? new Date();

  try {
    const rate = await getRateForDate(date);
    return NextResponse.json({
      jpyPerUsd: rate.jpyPerUsd,
      effectiveDate: toDateInputValue(rate.effectiveDate),
      isFallback: rate.isFallback,
      distanceDays: rate.distanceDays,
    });
  } catch (error) {
    const message =
      error instanceof FxUnavailableError
        ? error.message
        : "Could not load an exchange rate.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
