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
import { formatRate } from "@/lib/currency";

type FxState = {
  jpyPerUsd: number | null;
  effectiveDate: string | null;
  isFallback: boolean;
  /** Days between the rate's date and the one asked for. */
  distanceDays: number;
  loading: boolean;
  error: string | null;
};

const FxContext = createContext<FxState>({
  jpyPerUsd: null,
  effectiveDate: null,
  isFallback: false,
  distanceDays: 0,
  loading: false,
  error: null,
});

/**
 * Loads the USD/JPY rate for the transaction date and shares it with every
 * MoneyInput on the form, so a form with six amounts still makes one request.
 */
export function FxRateProvider({
  date,
  children,
}: {
  date: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<FxState>({
    jpyPerUsd: null,
    effectiveDate: null,
    isFallback: false,
    distanceDays: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    fetch(`/api/fx?date=${encodeURIComponent(date)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setState({
            jpyPerUsd: null, effectiveDate: null, isFallback: false, distanceDays: 0,
            loading: false, error: body?.error ?? "Could not load an exchange rate.",
          });
          return;
        }
        setState({
          jpyPerUsd: body.jpyPerUsd,
          effectiveDate: body.effectiveDate,
          isFallback: Boolean(body.isFallback),
          distanceDays: Number(body.distanceDays ?? 0),
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            jpyPerUsd: null, effectiveDate: null, isFallback: false, distanceDays: 0,
            loading: false, error: "Could not load an exchange rate.",
          });
        }
      });

    return () => { cancelled = true; };
  }, [date]);

  return <FxContext.Provider value={state}>{children}</FxContext.Provider>;
}

export function useFxRate(): FxState {
  return useContext(FxContext);
}

/** Shows which rate the form is converting at, and where it came from. */
export function FxRateNotice({ date }: { date: string }) {
  const fx = useFxRate();

  if (fx.loading) {
    return <p className="text-xs text-slate-500">Loading the exchange rate…</p>;
  }
  if (fx.error) {
    return (
      <p className="text-xs text-amber-300">
        {fx.error} Enter both amounts by hand and they&apos;ll be saved as typed.
      </p>
    );
  }
  if (!fx.jpyPerUsd) return null;

  // A weekend roll-back is a day or two and unremarkable. A substitute from
  // weeks or years away is a number you should not silently trust.
  const isDistant = fx.distanceDays > 7;

  return (
    <p className={`text-xs ${isDistant ? "text-amber-300" : "text-slate-500"}`}>
      Converting at <span className={isDistant ? "" : "text-slate-300"}>{formatRate(fx.jpyPerUsd)}</span>
      {fx.isFallback ? (
        <>
          {" "}
          — no rate is published for {date}
          {fx.effectiveDate ? `, so this is from ${fx.effectiveDate}` : ""}
          {fx.distanceDays > 1 ? ` (${fx.distanceDays} days away)` : ""}.
          {isDistant ? " That's too far off to trust — enter both amounts by hand." : ""}
        </>
      ) : fx.effectiveDate && fx.effectiveDate !== date ? (
        <span> — markets were shut on {date}, using {fx.effectiveDate}</span>
      ) : null}
    </p>
  );
}

function roundYen(usd: number, rate: number): string {
  return String(Math.round(usd * rate));
}

function roundUsd(yen: number, rate: number): string {
  return (yen / rate).toFixed(2);
}

/**
 * A single amount, entered in either currency. Typing in one box fills the
 * other at the rate for the transaction date; whichever pair is on screen is
 * what gets saved, so a marketplace's own conversion can be typed in directly.
 *
 * Submits `${name}Usd` and `${name}Jpy`.
 */
export function MoneyInput({
  name,
  label,
  hint,
  required = false,
  currency = "USD",
  defaultUsd = "",
  defaultJpy = "",
  compact = false,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Which box reads as the primary one for this record. */
  currency?: Currency;
  defaultUsd?: string;
  defaultJpy?: string;
  compact?: boolean;
}) {
  const fx = useFxRate();
  const [usd, setUsd] = useState(defaultUsd);
  const [jpy, setJpy] = useState(defaultJpy);
  // Which side the user last typed in — that side drives the conversion.
  const [driver, setDriver] = useState<Currency | null>(null);

  const rate = fx.jpyPerUsd;

  const onUsd = useCallback(
    (value: string) => {
      setUsd(value);
      setDriver("USD");
      if (!rate) return;
      const parsed = Number(value.replace(/[$,\s]/g, ""));
      setJpy(value.trim() === "" ? "" : Number.isFinite(parsed) ? roundYen(parsed, rate) : jpy);
    },
    [rate, jpy],
  );

  const onJpy = useCallback(
    (value: string) => {
      setJpy(value);
      setDriver("JPY");
      if (!rate) return;
      const parsed = Number(value.replace(/[¥￥,\s]/g, ""));
      setUsd(value.trim() === "" ? "" : Number.isFinite(parsed) ? roundUsd(parsed, rate) : usd);
    },
    [rate, usd],
  );

  // When the rate arrives or the date changes, refresh the derived side.
  useEffect(() => {
    if (!rate || !driver) return;
    if (driver === "USD") {
      const parsed = Number(usd.replace(/[$,\s]/g, ""));
      if (usd.trim() !== "" && Number.isFinite(parsed)) setJpy(roundYen(parsed, rate));
    } else {
      const parsed = Number(jpy.replace(/[¥￥,\s]/g, ""));
      if (jpy.trim() !== "" && Number.isFinite(parsed)) setUsd(roundUsd(parsed, rate));
    }
    // Only re-run when the rate itself moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  const usdFirst = currency !== "JPY";
  const usdBox = (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
        $
      </span>
      <input
        name={`${name}Usd`}
        value={usd}
        onChange={(e) => onUsd(e.target.value)}
        inputMode="decimal"
        placeholder="0.00"
        aria-label={`${label} in USD`}
        className="input pl-7"
      />
    </div>
  );
  const jpyBox = (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
        ¥
      </span>
      <input
        name={`${name}Jpy`}
        value={jpy}
        onChange={(e) => onJpy(e.target.value)}
        inputMode="numeric"
        placeholder="0"
        aria-label={`${label} in JPY`}
        className="input pl-7"
      />
    </div>
  );

  return (
    <div>
      <label className="label">
        {label}
        {required ? <span className="ml-1 text-rose-400">*</span> : null}
      </label>
      <div className={compact ? "space-y-2" : "grid grid-cols-2 gap-2"}>
        {usdFirst ? usdBox : jpyBox}
        {usdFirst ? jpyBox : usdBox}
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
