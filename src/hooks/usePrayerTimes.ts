import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { resolveLocation } from "./useWeather";

// Aladhan, method 13 = Diyanet İşleri Başkanlığı (Turkey). Its "Fajr" is Diyanet's İmsak.
export const PRAYERS = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"] as const;
export type PrayerName = (typeof PRAYERS)[number];
const CACHE_KEY = "cyexs-prayer-cache";

export interface NextPrayer {
  name: PrayerName;
  at: Date;
}

export type DayTimes = Partial<Record<PrayerName, string>>;
interface Cache { date: string; loc: string; city?: string; today: DayTimes; tomorrow: DayTimes }

export interface PrayerState {
  next: NextPrayer | null;
  /** Today's times as "HH:MM", or null until loaded. */
  today: DayTimes | null;
  city: string | null;
}

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

export function hhmm(time: string | undefined): string {
  return /^(\d{1,2}:\d{2})/.exec(time ?? "")?.[1] ?? "--:--";
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

export function usePrayerTimes(enabled: boolean): PrayerState {
  const [cache, setCache] = useState<Cache | null>(readCache);
  const [now, setNow] = useState(() => new Date());
  const [loc, setLoc] = useState<{ key: string; lat: number; lon: number; city?: string } | null>(null);

  // Tick every 15 s so the next prayer rolls over on time.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, [enabled]);

  // Same location as the weather; re-read it when the weather location changes.
  useEffect(() => {
    if (!enabled) return;
    const load = async () => {
      const l = await resolveLocation().catch(() => null);
      if (l) setLoc({ key: `${l.lat.toFixed(3)},${l.lon.toFixed(3)}`, lat: l.lat, lon: l.lon, city: l.city });
    };
    load();
    const un = listen("weather-refresh", () => { load(); });
    return () => { un.then((f) => f()); };
  }, [enabled]);

  const today = dayKey(now);
  useEffect(() => {
    if (!enabled || !loc || (cache?.date === today && cache.loc === loc.key)) return;
    let cancelled = false;
    (async () => {
      try {
        const day = new Date();
        const tomorrowDay = new Date(day);
        tomorrowDay.setDate(day.getDate() + 1);
        const [t1, t2] = await Promise.all([fetchDay(day, loc.lat, loc.lon), fetchDay(tomorrowDay, loc.lat, loc.lon)]);
        const next: Cache = { date: dayKey(day), loc: loc.key, city: loc.city, today: t1, tomorrow: t2 };
        if (cancelled) return;
        setCache(next);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* cache is optional */ }
      } catch {
        // Offline: try again on the next tick.
      }
    })();
    return () => { cancelled = true; };
    // Re-run on each tick until today's times are loaded (covers being offline at midnight).
  }, [enabled, today, loc, cache?.date, cache?.loc, now]);

  if (!enabled || !cache) return { next: null, today: null, city: loc?.city ?? null };
  const city = cache.city ?? loc?.city ?? null;
  if (cache.date === today) return { next: pickNext(now, cache.today, cache.tomorrow), today: cache.today, city };
  // A cache from yesterday still knows today's times as its "tomorrow".
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return cache.date === dayKey(yesterday)
    ? { next: pickNext(now, cache.tomorrow, {}), today: cache.tomorrow, city }
    : { next: null, today: null, city };
}
