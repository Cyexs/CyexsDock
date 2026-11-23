// Self-check for the cat mascot logic: bun scripts/selfcheck-mascot.ts
import { autoOutfit, catEngineState, catPose, clampToScreen, clickReaction, resolveCatColor, resolveOutfit } from "../src/mascot/mascot.ts";

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("FAIL", m, a, b);
    process.exit(1);
  }
};

eq(catPose({ agent: "needs_input", music: true, idleMs: 0 }), "needs-input", "agent wins");
eq(catPose({ agent: "tool", music: false, idleMs: 0 }), "working", "tool is working");
eq(catPose({ agent: null, music: true, idleMs: 0 }), "music", "music");
eq(catPose({ agent: null, music: false, idleMs: 10 * 60_000 }), "sleeping", "sleep");
eq(catPose({ agent: null, music: false, idleMs: 0 }), "idle", "idle");
eq(autoOutfit(new Date(2026, 9, 15)), "witch", "october");
eq(autoOutfit(new Date(2026, 11, 3)), "santa", "december");
eq(autoOutfit(new Date(2026, 2, 20)), "bayram", "ramazan bayrami 2026");
eq(autoOutfit(new Date(2026, 4, 27)), "bayram", "kurban bayrami 2026");
eq(autoOutfit(new Date(2031, 2, 20)), "none", "after table, no crash");
eq(autoOutfit(new Date(2026, 6, 1)), "none", "plain day");
eq(resolveOutfit("santa", new Date(2026, 6, 1)), "santa", "manual");
eq(resolveOutfit("bogus", new Date(2026, 6, 1)), "none", "unknown id");
eq(resolveOutfit("auto", new Date(2026, 9, 15)), "witch", "auto");
eq(resolveOutfit(null, new Date(2026, 9, 15)), "witch", "null is auto");
eq(clickReaction([0, 500, 1000], 1000), "dizzy", "3 fast clicks");
eq(clickReaction([0, 2000, 4000], 4000), "pet", "3 slow clicks");
eq(clickReaction([1000], 1000), "pet", "1 click");
eq(clickReaction([0, 700], 700), "angry", "2 fast clicks");
eq(clickReaction([0, 2000], 2000), "pet", "2 slow clicks");
eq(
  (["idle", "working", "needs-input", "done", "error", "sleeping", "music"] as const).map(catEngineState),
  ["idle", "working", "approval", "finished", "error", "sleeping", "idle"],
  "pose to engine state",
);
eq(["white", "black", "ginger", "tabby", "grey"].map(resolveCatColor), ["white", "black", "ginger", "tabby", "grey"], "valid colours");
eq([null, undefined, "pink", "", 3].map(resolveCatColor), ["white", "white", "white", "white", "white"], "bad colour is white");
const scr = [{ x: 0, y: 0, w: 1920, h: 1080 }];
eq(clampToScreen({ x: 100, y: 100 }, scr, { w: 140, h: 160 }), { x: 100, y: 100 }, "on screen");
eq(clampToScreen({ x: 3000, y: 100 }, scr, { w: 140, h: 160 }), { x: 40, y: 40 }, "monitor unplugged");
console.log("selfcheck-mascot OK");
