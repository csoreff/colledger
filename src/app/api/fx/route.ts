import { NextResponse } from "next/server";
import type { Currency } from "@prisma/client";
import { getRateForDate, FxUnavailableError } from "@/lib/fx";
import { parseDateInput, toDateInputValue } from "@/lib/dates";
import { CURRENCIES } from "@/lib/currency";

export const dynamic = "force-dynamic";

/**
 * Feeds live currency conversion in the entry forms.
 * GET /api/fx?date=YYYY-MM-DD&currency=GBP
 *
 * `currency` is the one the form is transacting in; rows cached before GBP/AUD
 * support hold only a JPY rate, so naming it forces a refetch when needed.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = parseDateInput(searchParams.get("date")) ?? new Date();
  const requested = searchParams.get("currency") ?? "JPY";
  const currency = (CURRENCIES.includes(requested as Currency) ? requested : "JPY") as Currency;

  try {
    const rate = await getRateForDate(date, currency);
    return NextResponse.json({
      jpyPerUsd: rate.jpyPerUsd,
      rates: rate.rates,
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
