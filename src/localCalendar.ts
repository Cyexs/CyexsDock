// Local (account-free) calendar: storage, recurrence expansion, Turkish public holidays, reminders.
// Pure logic only (no React) so scripts/selfcheck-calendar.ts can run it under bun.
import { invoke } from "@tauri-apps/api/core";
import type { CalEvent } from "./hooks/useCaldav";

export const EVENTS_KEY = "cyexs-local-events";
export const HOLIDAYS_KEY = "cyexs-holidays-enabled";
export const LOCAL_SOURCE = "__local";
export const HOLIDAY_SOURCE = "__holidays";
export const HOLIDAY_COLOR = "#ff453a";
export const COLORS = ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#40c8e0", "#98989d"];
export const REMINDER_CHOICES: (number | null)[] = [null, 0, 5, 10, 15, 30, 60, 1440];

export type Repeat = "none" | "daily" | "weekly" | "monthly" | "yearly";
export const REPEATS: Repeat[] = ["none", "daily", "weekly", "monthly", "yearly"];

/** Stored shape. All-day: start = local midnight of the first day, end = local midnight AFTER the last day (exclusive, like CalEvent). */
export interface LocalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  color: string;
  notes?: string;
  repeat: Repeat;
  reminderMinutes: number | null;
}

const DAY = 86_400_000;

export function sanitizeEvents(raw: unknown): LocalEvent[] {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: LocalEvent[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.title !== "string") continue;
    if (!Number.isFinite(e.start) || !Number.isFinite(e.end) || e.end < e.start) continue;
    out.push({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: !!e.allDay,
      color: typeof e.color === "string" ? e.color : COLORS[0],
      notes: typeof e.notes === "string" && e.notes ? e.notes : undefined,
      repeat: REPEATS.includes(e.repeat) ? e.repeat : "none",
      reminderMinutes: typeof e.reminderMinutes === "number" && Number.isFinite(e.reminderMinutes) ? e.reminderMinutes : null,
    });
  }
  return out;
}

export const parseHolidays = (v: unknown) => v !== false && v !== "false";

export async function loadLocalState(): Promise<{ events: LocalEvent[]; holidays: boolean }> {
  const s = await invoke<Record<string, unknown>>("load_settings").catch(() => ({} as Record<string, unknown>));
  return { events: sanitizeEvents(s[EVENTS_KEY]), holidays: parseHolidays(s[HOLIDAYS_KEY]) };
}

export const saveLocalEvents = (events: LocalEvent[]) => invoke("save_setting", { key: EVENTS_KEY, value: events });

export const newEventId = () => `ev${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ---- Recurrence ----

/** Start of occurrence n in ms (null when that period has no such day), plus a nominal ms used to stop the loop. */
function occurrence(base: Date, repeat: Repeat, n: number): [number | null, number] {
  const y = base.getFullYear(), m = base.getMonth(), d = base.getDate();
  const h = base.getHours(), mi = base.getMinutes(), s = base.getSeconds(), ms = base.getMilliseconds();
  if (repeat === "monthly") {
    const t = new Date(y, m + n, d, h, mi, s, ms);
    // Day 31 in a 30-day month overflows into the next month: skip that month.
    return [t.getDate() === d ? t.getTime() : null, new Date(y, m + n, 1).getTime()];
  }
  if (repeat === "yearly") {
    const t = new Date(y + n, m, d, h, mi, s, ms);
    // Feb 29 in a non-leap year overflows into March: skip that year.
    return [t.getMonth() === m ? t.getTime() : null, new Date(y + n, 0, 1).getTime()];
  }
  const t = new Date(y, m, d + n * (repeat === "weekly" ? 7 : 1), h, mi, s, ms).getTime();
  return [t, t];
}

function firstIndex(e: LocalEvent, from: number): number {
  const lo = new Date(from - (e.end - e.start) - DAY);
  const b = new Date(e.start);
  if (e.repeat === "daily") return Math.max(0, Math.floor((lo.getTime() - e.start) / DAY));
  if (e.repeat === "weekly") return Math.max(0, Math.floor((lo.getTime() - e.start) / (7 * DAY)));
  if (e.repeat === "monthly") return Math.max(0, (lo.getFullYear() - b.getFullYear()) * 12 + lo.getMonth() - b.getMonth());
  if (e.repeat === "yearly") return Math.max(0, lo.getFullYear() - b.getFullYear());
  return 0;
}

/** Occurrences (start/end ms) of one event overlapping [from, to). */
function occurrences(e: LocalEvent, from: number, to: number): { start: number; end: number }[] {
  const dur = e.end - e.start;
  const out: { start: number; end: number }[] = [];
  const push = (s: number) => {
    let end = s + dur;
    if (e.allDay) {
      const d = new Date(s);
      end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + Math.round(dur / DAY)).getTime();
    }
    if (s < to && end > from) out.push({ start: s, end });
  };
  if (e.repeat === "none") {
    push(e.start);
    return out;
  }
  const base = new Date(e.start);
  for (let n = firstIndex(e, from), guard = 0; guard < 20_000; n++, guard++) {
    const [s, nominal] = occurrence(base, e.repeat, n);
    if (nominal >= to) break;
    if (s !== null) push(s);
  }
  return out;
}

export function expandLocal(events: LocalEvent[], from: number, to: number): CalEvent[] {
  const out: CalEvent[] = [];
  for (const e of events) {
    for (const o of occurrences(e, from, to)) {
      out.push({
        uid: `local:${e.id}`,
        calendar: LOCAL_SOURCE,
        color: e.color,
        title: e.title,
        location: null,
        allDay: e.allDay,
        start: o.start,
        end: o.end,
        source: "local",
        localId: e.id,
      });
    }
  }
  return out;
}

// ---- Turkish public holidays ----

// Source: Diyanet İşleri Başkanlığı dini günler takvimi (first day of Ramazan and Kurban Bayramı, 2025-2030).
// Dates from 2027 on are the published astronomical calculations; Diyanet can shift one by a day.
// This table must be extended after 2030, otherwise only the fixed national days appear for later years.
// [Ramazan month, day, Kurban month, day] (month is 1-based)
const BAYRAM: Record<number, [number, number, number, number]> = {
  2025: [3, 30, 6, 6],
  2026: [3, 20, 5, 27],
  2027: [3, 9, 5, 16],
  2028: [2, 27, 5, 5],
  2029: [2, 15, 4, 24],
  2030: [2, 5, 4, 14],
};

const FIXED: [number, number, string][] = [
  [1, 1, "Yılbaşı"],
  [4, 23, "Ulusal Egemenlik ve Çocuk Bayramı"],
  [5, 1, "Emek ve Dayanışma Günü"],
  [5, 19, "Atatürk'ü Anma, Gençlik ve Spor Bayramı"],
  [7, 15, "Demokrasi ve Millî Birlik Günü"],
  [8, 30, "Zafer Bayramı"],
  [10, 29, "Cumhuriyet Bayramı"],
];

function holiday(year: number, month0: number, day: number, title: string): CalEvent {
  const start = new Date(year, month0, day); // Date normalizes day overflow/underflow
  const next = new Date(year, month0, day + 1);
  return {
    uid: `holiday:${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`,
    calendar: HOLIDAY_SOURCE,
    color: HOLIDAY_COLOR,
    title,
    location: null,
    allDay: true,
    start: start.getTime(),
    end: next.getTime(),
    source: "holiday",
  };
}

export function turkishHolidays(year: number): CalEvent[] {
  const out = FIXED.map(([m, d, title]) => holiday(year, m - 1, d, title));
  const b = BAYRAM[year];
  if (b) {
    const feast = (m: number, d: number, name: string, days: number) => {
      out.push(holiday(year, m - 1, d - 1, `${name} Arifesi (yarım gün)`));
      for (let i = 0; i < days; i++) out.push(holiday(year, m - 1, d + i, `${name} ${i + 1}. Gün`));
    };
    feast(b[0], b[1], "Ramazan Bayramı", 3);
    feast(b[2], b[3], "Kurban Bayramı", 4);
  }
  return out;
}

export function holidaysInRange(from: number, to: number): CalEvent[] {
  const out: CalEvent[] = [];
  for (let y = new Date(from).getFullYear(); y <= new Date(to).getFullYear(); y++) {
    for (const h of turkishHolidays(y)) if (h.start < to && h.end > from) out.push(h);
  }
  return out;
}

// ---- Reminders ----

export interface DueReminder {
  key: string;
  title: string;
  start: number;
  minutes: number;
}

/** Occurrences whose reminder time passed within the last windowMs. key = event id + occurrence start. */
export function dueReminders(events: LocalEvent[], now: number, windowMs = 120_000): DueReminder[] {
  const out: DueReminder[] = [];
  for (const e of events) {
    if (e.reminderMinutes === null) continue;
    const lead = e.reminderMinutes * 60_000;
    // Reminder time of an occurrence = start - lead; it is due when that lies in (now - window, now].
    for (const o of occurrences(e, now - windowMs + lead, now + lead + 1)) {
      const at = o.start - lead;
      if (at <= now && at > now - windowMs) {
        out.push({ key: `${e.id}:${o.start}`, title: e.title, start: o.start, minutes: e.reminderMinutes });
      }
    }
  }
  return out;
}
