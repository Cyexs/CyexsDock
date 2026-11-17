// Self-check for the local calendar (recurrence, holidays, reminders): bun scripts/selfcheck-calendar.ts
import { dueReminders, expandLocal, holidaysInRange, sanitizeEvents, type LocalEvent } from "../src/localCalendar.ts";

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("FAIL", m, a, b);
    process.exit(1);
  }
};

const ev = (o: Partial<LocalEvent>): LocalEvent => ({
  id: "a", title: "T", start: 0, end: 0, allDay: false, color: "#0a84ff", repeat: "none", reminderMinutes: null, ...o,
});
const ms = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const days = (list: { start: number }[]) => list.map((o) => { const d = new Date(o.start); return `${d.getMonth() + 1}-${d.getDate()}`; });

// monthly on the 31st skips months without a 31st
const m31 = ev({ start: ms(2026, 1, 31, 9), end: ms(2026, 1, 31, 10), repeat: "monthly" });
eq(days(expandLocal([m31], ms(2026, 1, 1), ms(2026, 7, 1))), ["1-31", "3-31", "5-31"], "monthly day 31");

// yearly Feb 29 only in leap years
const y29 = ev({ start: ms(2024, 2, 29, 9), end: ms(2024, 2, 29, 10), repeat: "yearly" });
eq(expandLocal([y29], ms(2024, 1, 1), ms(2033, 1, 1)).map((o) => new Date(o.start).getFullYear()), [2024, 2028, 2032], "yearly Feb 29");

// daily / weekly counts, window far after the first occurrence
const daily = ev({ start: ms(2026, 1, 1, 8), end: ms(2026, 1, 1, 9), repeat: "daily" });
eq(expandLocal([daily], ms(2026, 6, 10), ms(2026, 6, 13)).length, 3, "daily window");
const weekly = ev({ start: ms(2026, 1, 5, 8), end: ms(2026, 1, 5, 9), repeat: "weekly" });
eq(days(expandLocal([weekly], ms(2026, 3, 1), ms(2026, 3, 20))), ["3-2", "3-9", "3-16"], "weekly");

// none: single occurrence, outside window gives nothing
const one = ev({ start: ms(2026, 5, 1, 8), end: ms(2026, 5, 1, 9) });
eq(expandLocal([one], ms(2026, 5, 1), ms(2026, 5, 2)).length, 1, "single in window");
eq(expandLocal([one], ms(2026, 5, 2), ms(2026, 5, 9)).length, 0, "single outside window");

// multi-day all-day event keeps its length on repeat
const trip = ev({ allDay: true, start: ms(2026, 1, 10), end: ms(2026, 1, 13), repeat: "monthly" });
const trips = expandLocal([trip], ms(2026, 2, 1), ms(2026, 3, 1));
eq([trips.length, trips[0].start, trips[0].end], [1, ms(2026, 2, 10), ms(2026, 2, 13)], "all-day multi-day monthly");

// sanitize drops garbage, keeps valid, parses JSON strings
eq(sanitizeEvents([{ id: 1 }, null, ev({ id: "ok" })]).map((e) => e.id), ["ok"], "sanitize");
eq(sanitizeEvents(JSON.stringify([ev({ id: "s" })])).length, 1, "sanitize json string");

// holidays: 29 Ekim, 1 Ocak, and the 2026 bayrams (Ramazan 20-22 Mart, Kurban 27-30 Mayis) with arife
const h = holidaysInRange(ms(2026, 1, 1), ms(2027, 1, 1));
const titleOn = (m: number, d: number) => h.find((x) => x.start === ms(2026, m, d))?.title;
eq(titleOn(10, 29), "Cumhuriyet Bayramı", "29 Ekim");
eq(titleOn(1, 1), "Yılbaşı", "1 Ocak");
eq([20, 21, 22].map((d) => titleOn(3, d)), ["Ramazan Bayramı 1. Gün", "Ramazan Bayramı 2. Gün", "Ramazan Bayramı 3. Gün"], "ramazan bayrami");
eq([27, 28, 29, 30].map((d) => titleOn(5, d)?.slice(0, 14)), ["Kurban Bayramı", "Kurban Bayramı", "Kurban Bayramı", "Kurban Bayramı"], "kurban bayrami");
eq(titleOn(3, 19), "Ramazan Bayramı Arifesi (yarım gün)", "ramazan arife");
eq(titleOn(5, 26), "Kurban Bayramı Arifesi (yarım gün)", "kurban arife");
eq(h.every((x) => x.allDay && x.source === "holiday"), true, "holidays all-day");
eq(new Date(ms(2026, 3, 20)).getDay(), 5, "2026 Ramazan Bayrami is a Friday");
eq(new Set(h.map((x) => x.uid)).size, h.length, "unique holiday uids");

// reminders: due within the last 2 minutes only
const meet = ev({ start: ms(2026, 4, 1, 10, 0), end: ms(2026, 4, 1, 11, 0), reminderMinutes: 10 });
eq(dueReminders([meet], ms(2026, 4, 1, 9, 49)).length, 0, "reminder not yet");
eq(dueReminders([meet], ms(2026, 4, 1, 9, 51)).length, 1, "reminder due");
eq(dueReminders([meet], ms(2026, 4, 1, 9, 53)).length, 0, "reminder expired");
const atStart = ev({ start: ms(2026, 4, 1, 10, 0), end: ms(2026, 4, 1, 11, 0), reminderMinutes: 0 });
eq(dueReminders([atStart], ms(2026, 4, 1, 10, 1)).map((r) => r.key), [`a:${ms(2026, 4, 1, 10, 0)}`], "at start key");
const dayBefore = ev({ start: ms(2026, 4, 2, 10, 0), end: ms(2026, 4, 2, 11, 0), reminderMinutes: 1440 });
eq(dueReminders([dayBefore], ms(2026, 4, 1, 10, 1)).length, 1, "one day before");
const dailyRem = ev({ start: ms(2026, 1, 1, 8), end: ms(2026, 1, 1, 9), repeat: "daily", reminderMinutes: 5 });
eq(dueReminders([dailyRem], ms(2026, 9, 9, 7, 56)).length, 1, "daily recurring reminder");

console.log("ok");
