import { useEffect, useState } from "react";
import { resolveLocation } from "./useWeather";

// Aladhan, method 13 = Diyanet İşleri Başkanlığı (Turkey). Its "Fajr" is Diyanet's İmsak.
const PRAYERS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;
export type PrayerName = (typeof PRAYERS)[number];
const CACHE_KEY = "cyexs-prayer-cache";

export interface NextPrayer {
  name: PrayerName;
  at: Date;
}

type DayTimes = Partial<Record<PrayerName, string>>;
interface Cache { date: string; today: DayTimes; tomorrow: DayTimes }

function dayKey(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

/** "17:51" or "17:51 (+03)" on the given day. */
function at(day: Date, hhmm: string | undefined): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return null;
  const d = new Date(day);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

export function pickNext(now: Date, today: DayTimes, tomorrow: DayTimes): NextPrayer | null {
  for (const name of PRAYERS) {
    const time = at(now, today[name]);
    if (time && time > now) return { name, at: time };
  }
  const nextDay = new Date(now);
  nextDay.setDate(now.getDate() + 1);
  const first = at(nextDay, tomorrow.Fajr);
  return first ? { name: "Fajr", at: first } : null;
}

async function fetchDay(day: Date, lat: number, lon: number): Promise<DayTimes> {
  const res = await fetch(`https://api.aladhan.com/v1/timings/${dayKey(day)}?latitude=${lat}&longitude=${lon}&method=13`);
  if (!res.ok) throw new Error(`prayer times: HTTP ${res.status}`);
  const data = await res.json();
  return data?.data?.timings ?? {};
}

function readCache(): Cache | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function usePrayerTimes(enabled: boolean): NextPrayer | null {
  const [cache, setCache] = useState<Cache | null>(readCache);
  const [now, setNow] = useState(() => new Date());

  // Tick every 30 s so the next prayer rolls over on time.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [enabled]);

  const today = dayKey(now);
  useEffect(() => {
    if (!enabled || cache?.date === today) return;
    let cancelled = false;
    (async () => {
      try {
        const location = await resolveLocation();
        if (!location) return;
        const day = new Date();
        const tomorrowDay = new Date(day);
        tomorrowDay.setDate(day.getDate() + 1);
        const [t1, t2] = await Promise.all([
          fetchDay(day, location.lat, location.lon),
          fetchDay(tomorrowDay, location.lat, location.lon),
        ]);
        const next: Cache = { date: dayKey(day), today: t1, tomorrow: t2 };
        if (cancelled) return;
        setCache(next);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* cache is optional */ }
      } catch {
        // Offline: try again on the next tick.
      }
    })();
    return () => { cancelled = true; };
    // Re-run on each tick until today's times are loaded (covers being offline at midnight).
  }, [enabled, today, cache?.date, now]);

  if (!enabled || !cache) return null;
  // A cache from yesterday still knows today's times as its "tomorrow".
  if (cache.date !== today) {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return cache.date === dayKey(yesterday) ? pickNext(now, cache.tomorrow, {}) : null;
  }
  return pickNext(now, cache.today, cache.tomorrow);
}
