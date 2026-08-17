"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Currency } from "@prisma/client";
import {
  CURRENCY_DECIMALS,
  CURRENCY_SYMBOLS,
  formatRate,
  isReportingCurrency,
  minorUnits,
  type RateTable,
} from "@/lib/currency";

type FxState = {
  jpyPerUsd: number | null;
  /** Units per 1 USD for each supported currency. */
  rates: RateTable | null;
  effectiveDate: string | null;
  isFallback: boolean;
  /** Days between the rate's date and the one asked for. */
  distanceDays: number;
  loading: boolean;
  error: string | null;
};

const EMPTY: FxState = {
  jpyPerUsd: null,
  rates: null,
  effectiveDate: null,
  isFallback: false,
  distanceDays: 0,
  loading: false,
  error: null,
};

const FxContext = createContext<FxState>(EMPTY);

/**
 * Loads the rates for the transaction date and shares them with every
 * MoneyInput on the form, so a form with six amounts still makes one request.
 * `currency` names what the form is transacting in, because rates cached before
 * GBP/AUD support hold only JPY.
 */
export function FxRateProvider({
  date,
  currency = "JPY",
  children,
}: {
  date: string;
  currency?: Currency;
  children: ReactNode;
}) {
  const [state, setState] = useState<FxState>({ ...EMPTY, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetch(`/api/fx?date=${encodeURIComponent(date)}&currency=${currency}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({ ...EMPTY, error: body?.error ?? "Could not load an exchange rate." });
          return;
        }
        setState({
          jpyPerUsd: body.jpyPerUsd,
          rates: body.rates ?? null,
          effectiveDate: body.effectiveDate,
          isFallback: Boolean(body.isFallback),
          distanceDays: Number(body.distanceDays ?? 0),
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ ...EMPTY, error: "Could not load an exchange rate." });
      });

    return () => {
      cancelled = true;
    };
  }, [date, currency]);

  return <FxContext.Provider value={state}>{children}</FxContext.Provider>;
}

export function useFxRate(): FxState {
  return useContext(FxContext);
}

/** Shows which rate the form is converting at, and where it came from. */
export function FxRateNotice({
  date,
  currency = "JPY",
}: {
  date: string;
  currency?: Currency;
}) {
  const fx = useFxRate();

  if (fx.loading) {
    return <p className="text-xs text-slate-500">Loading the exchange rate…</p>;
  }
  if (fx.error) {
    return (
      <p className="text-xs text-amber-300">
        {fx.error} Enter the amounts by hand and they&apos;ll be saved as typed.
      </p>
    );
  }
  if (!fx.jpyPerUsd) return null;

  const nativePerUsd = fx.rates?.[currency];
  if (!isReportingCurrency(currency) && !nativePerUsd) {
    return (
      <p className="text-xs text-amber-300">
        No {currency} rate is published for {date}. Enter the USD and JPY amounts
        by hand.
      </p>
    );
  }

  // A weekend roll-back is a day or two and unremarkable. A substitute from
  // weeks or years away is a number you should not silently trust.
  const isDistant = fx.distanceDays > 7;

  return (
    <p className={`text-xs ${isDistant ? "text-amber-300" : "text-slate-500"}`}>
      Converting at{" "}
      <span className={isDistant ? "" : "text-slate-300"}>
        {formatRate(fx.jpyPerUsd)}
        {nativePerUsd && !isReportingCurrency(currency)
          ? ` · ${nativePerUsd.toFixed(4)} ${currency} / $1`
          : ""}
      </span>
      {fx.isFallback ? (
        <>
          {" "}
          — no rate is published for {date}
          {fx.effectiveDate ? `, so this is from ${fx.effectiveDate}` : ""}
          {fx.distanceDays > 1 ? ` (${fx.distanceDays} days away)` : ""}.
          {isDistant ? " That's too far off to trust — enter the amounts by hand." : ""}
        </>
      ) : fx.effectiveDate && fx.effectiveDate !== date ? (
        <span>
          {" "}
          — markets were shut on {date}, using {fx.effectiveDate}
        </span>
      ) : null}
    </p>
  );
}

function toNumber(value: string): number | null {
  const cleaned = value.replace(/[$¥￥£,\s]/gi, "").replace(/^A(?=[\d.-])/i, "");
  if (cleaned.trim() === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A single amount, entered in any supported currency.
 *
 * USD and JPY are always shown, because they are what every total in the app is
 * computed in. When the transaction settled in GBP or AUD, that currency gets
 * its own box and leads. Typing in any box fills the others at the rate for the
 * transaction date, and every box is submitted — so when a marketplace gives
 * you its own converted figure you can type it in and keep it, rather than
 * having it overwritten by the mid-market rate.
 *
 * Submits `${name}Usd`, `${name}Jpy`, and for GBP/AUD also `${name}Native`.
 */
export function MoneyInput({
  name,
  label,
  hint,
  required = false,
  currency = "USD",
  defaultUsd = "",
  defaultJpy = "",
  defaultNative = "",
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  currency?: Currency;
  defaultUsd?: string;
  defaultJpy?: string;
  defaultNative?: string;
}) {
  const fx = useFxRate();
  const [usd, setUsd] = useState(defaultUsd);
  const [jpy, setJpy] = useState(defaultJpy);
  const [native, setNative] = useState(defaultNative);
  // Which box the user last typed in — that one drives the others.
  const [driver, setDriver] = useState<Currency | null>(null);

  const jpyPerUsd = fx.jpyPerUsd;
  const nativePerUsd = fx.rates?.[currency] ?? null;
  const showNative = !isReportingCurrency(currency);

  /** Recomputes every box other than `from`, working from a USD figure. */
  const spread = useCallback(
    (usdValue: number | null, from: Currency) => {
      if (usdValue === null) {
        if (from !== "USD") setUsd("");
        if (from !== "JPY") setJpy("");
        if (showNative && from !== currency) setNative("");
        return;
      }
      if (from !== "USD") setUsd(usdValue.toFixed(2));
      if (from !== "JPY" && jpyPerUsd) setJpy(String(Math.round(usdValue * jpyPerUsd)));
      if (showNative && from !== currency && nativePerUsd) {
        setNative((usdValue * nativePerUsd).toFixed(CURRENCY_DECIMALS[currency]));
      }
    },
    [currency, jpyPerUsd, nativePerUsd, showNative],
  );

  const onUsd = useCallback(
    (value: string) => {
      setUsd(value);
      setDriver("USD");
      spread(toNumber(value), "USD");
    },
    [spread],
  );

  const onJpy = useCallback(
    (value: string) => {
      setJpy(value);
      setDriver("JPY");
      const parsed = toNumber(value);
      spread(parsed !== null && jpyPerUsd ? parsed / jpyPerUsd : null, "JPY");
    },
    [spread, jpyPerUsd],
  );

  const onNative = useCallback(
    (value: string) => {
      setNative(value);
      setDriver(currency);
      const parsed = toNumber(value);
      spread(parsed !== null && nativePerUsd ? parsed / nativePerUsd : null, currency);
    },
    [spread, nativePerUsd, currency],
  );

  // When the rates arrive or the date changes, refresh the derived boxes from
  // whichever one the user actually typed in.
  useEffect(() => {
    if (!jpyPerUsd || !driver) return;
    if (driver === "USD") {
      spread(toNumber(usd), "USD");
    } else if (driver === "JPY") {
      const parsed = toNumber(jpy);
      spread(parsed !== null ? parsed / jpyPerUsd : null, "JPY");
    } else if (nativePerUsd) {
      const parsed = toNumber(native);
      spread(parsed !== null ? parsed / nativePerUsd : null, currency);
    }
    // Only re-run when the rates themselves move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jpyPerUsd, nativePerUsd]);

  const box = (
    boxCurrency: Currency,
    value: string,
    onChange: (v: string) => void,
    inputName: string,
  ) => {
    const symbol = CURRENCY_SYMBOLS[boxCurrency];
    return (
      <div className="relative" key={inputName}>
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
          {symbol}
        </span>
        <input
          name={inputName}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={CURRENCY_DECIMALS[boxCurrency] === 0 ? "numeric" : "decimal"}
          placeholder={minorUnits(boxCurrency) === 1 ? "0" : "0.00"}
          aria-label={`${label} in ${boxCurrency}`}
          className={`input ${symbol.length > 1 ? "pl-9" : "pl-7"}`}
        />
      </div>
    );
  };

  const usdBox = box("USD", usd, onUsd, `${name}Usd`);
  const jpyBox = box("JPY", jpy, onJpy, `${name}Jpy`);

  const boxes = showNative
    ? [box(currency, native, onNative, `${name}Native`), usdBox, jpyBox]
    : currency === "JPY"
      ? [jpyBox, usdBox]
      : [usdBox, jpyBox];

  return (
    <div>
      <label className="label">
        {label}
        {required ? <span className="ml-1 text-rose-400">*</span> : null}
      </label>
      <div className={`grid gap-2 ${showNative ? "sm:grid-cols-3" : "grid-cols-2"}`}>
        {boxes}
      </div>
      {showNative ? (
        <p className="mt-1 text-xs text-slate-500">
          Paid in {currency}. The USD and JPY figures are what every total in the
          app is computed from.
        </p>
      ) : null}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
