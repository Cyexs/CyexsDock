// Self-check for the market and prayer widget helpers: bun scripts/selfcheck-widgets.ts
import { parseTrNumber, parseQuote, formatTry } from "../src/hooks/useMarkets.ts";
import { pickNext } from "../src/hooks/usePrayerTimes.ts";

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("FAIL", m, a, b);
    process.exit(1);
  }
};

eq(parseTrNumber("6.270,61"), 6270.61, "thousands separator");
eq(parseTrNumber("%-0,25"), -0.25, "negative percent");
eq(parseQuote({ Selling: "50,4237", Change: "%0,06" }), { price: 50.4237, change: 0.06 }, "quote");
eq(parseQuote({}), null, "missing price");

const today = { Fajr: "06:18", Sunrise: "07:47", Dhuhr: "12:54", Asr: "15:28", Maghrib: "17:51", Isha: "19:14" };
const at = (h: number, m: number) => new Date(2026, 10, 17, h, m);
eq(pickNext(at(13, 0), today, today)?.name, "Asr", "afternoon");
eq(pickNext(at(5, 0), today, today)?.name, "Fajr", "before dawn");
const late = pickNext(at(20, 0), today, { Fajr: "06:19" });
eq([late?.name, late?.at.getDate(), late?.at.getHours(), late?.at.getMinutes()], ["Fajr", 18, 6, 19], "after isha rolls to tomorrow");

console.log("ok", formatTry(6270.61), formatTry(50.42));
