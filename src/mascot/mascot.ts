// Pure logic for the cat mascot: pose, seasonal outfit, click reaction.
import type { AgentState } from "../components/AgentStatus";
import { turkishHolidays } from "../localCalendar";

export type CatPose = "idle" | "working" | "needs-input" | "done" | "error" | "music" | "sleeping";
export type CatReaction = "pet" | "angry" | "dizzy" | "hearts";
export type OutfitId = "none" | "witch" | "santa" | "bayram";
export const OUTFITS: OutfitId[] = ["none", "witch", "santa", "bayram"];

export const SLEEP_AFTER_MS = 10 * 60_000;
export const DIZZY_WINDOW_MS = 1500;
export const HEARTS_HOVER_MS = 2000;

const AGENT_POSE: Record<AgentState, CatPose> = {
  working: "working",
  tool: "working",
  needs_input: "needs-input",
  done: "done",
  error: "error",
};

export function catPose(input: { agent: AgentState | null; music: boolean; idleMs: number }): CatPose {
  if (input.agent) return AGENT_POSE[input.agent];
  if (input.music) return "music";
  return input.idleMs >= SLEEP_AFTER_MS ? "sleeping" : "idle";
}

export function autoOutfit(date: Date): OutfitId {
  const t = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Only the religious feast days (not arife, not national "Bayramı" days like Zafer/Cumhuriyet).
  const bayram = turkishHolidays(date.getFullYear()).some(
    (h) => /^(Ramazan|Kurban) Bayramı \d\. Gün$/.test(h.title) && h.start === t,
  );
  if (bayram) return "bayram";
  const month = date.getMonth();
  if (month === 9) return "witch";
  if (month === 11) return "santa";
  return "none";
}

export function resolveOutfit(setting: string | null, date: Date): OutfitId {
  if (setting === null || setting === "auto") return autoOutfit(date);
  return (OUTFITS as string[]).includes(setting) ? (setting as OutfitId) : "none";
}

export function clickReaction(clickTimes: number[], now: number): CatReaction {
  const n = clickTimes.filter((t) => now - t < DIZZY_WINDOW_MS).length;
  return n >= 3 ? "dizzy" : n === 2 ? "angry" : "pet";
}

export type CatManifest = { outfits: Partial<Record<OutfitId, string[]>> };
export type CatClip = CatPose | CatReaction | "idle-left" | "idle-right" | "idle-scratch";

const POSES: string[] = ["idle", "working", "needs-input", "done", "error", "music", "sleeping"];

// 3D clip for the outfit, else the no-outfit clip, else the pixel SVG (non-pose clips use idle).
export function catSrc(m: CatManifest, outfit: OutfitId, clip: CatClip, sit = false): string {
  if (m.outfits[outfit]?.includes(clip)) return `/cat/${outfit}/${clip}.webp`;
  if (m.outfits.none?.includes(clip)) return `/cat/none/${clip}.webp`;
  return `/mascot/${POSES.includes(clip) ? clip : "idle"}${sit ? "-sit" : ""}.svg`;
}

type Rect = { x: number; y: number; w: number; h: number };

// Saved desktop spot is kept if the cat's centre is on some screen; else (monitor gone) top-left of the first + 40.
export function clampToScreen(
  p: { x: number; y: number },
  screens: Rect[],
  size: { w: number; h: number },
): { x: number; y: number } {
  const cx = p.x + size.w / 2;
  const cy = p.y + size.h / 2;
  if (screens.some((s) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h)) return p;
  const first = screens[0] ?? { x: 0, y: 0 };
  return { x: first.x + 40, y: first.y + 40 };
}
