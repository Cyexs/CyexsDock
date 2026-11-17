import { useEffect, useState } from "react";
import { setVisibleInterval } from "./visibleInterval";

// Free, keyless feed with TRY prices for currencies and gold (Turkish number format: "6.270,61").
const MARKETS_URL = "https://finans.truncgil.com/v3/today.json";
const REFRESH_MS = 15 * 60 * 1000;
const CACHE_KEY = "cyexs-markets-cache";

export interface Quote {
  price: number;
  /** Daily change in percent, e.g. 0.51 or -0.2. */
  change: number;
}

export interface Markets {
  usd: Quote | null;
  eur: Quote | null;
  gold: Quote | null;
}

const EMPTY: Markets = { usd: null, eur: null, gold: null };

export function parseTrNumber(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const n = Number(text.replace(/[%\s]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseQuote(entry: unknown): Quote | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const price = parseTrNumber(e.Selling);
  if (price === null) return null;
  return { price, change: parseTrNumber(e.Change) ?? 0 };
}

function readCache(): Markets {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") };
  } catch {
    return EMPTY;
  }
}

export function useMarkets(enabled: boolean): Markets {
  const [markets, setMarkets] = useState<Markets>(readCache);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(MARKETS_URL);
        if (!res.ok) return;
        const data = await res.json();
        const next: Markets = { usd: parseQuote(data.USD), eur: parseQuote(data.EUR), gold: parseQuote(data["gram-altin"]) };
        if (cancelled || (!next.usd && !next.eur && !next.gold)) return;
        setMarkets(next);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* cache is optional */ }
      } catch {
        // Offline: keep showing the last prices.
      }
    };
    load();
    const id = setVisibleInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);

  return markets;
}

export function formatTry(price: number): string {
  return price.toLocaleString("tr-TR", { minimumFractionDigits: price >= 1000 ? 0 : 2, maximumFractionDigits: price >= 1000 ? 0 : 2 });
}
