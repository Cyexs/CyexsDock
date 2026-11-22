# Kedi Maskot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CyexsDock cat visible without an agent, give it reactions, a wardrobe and a desktop mode, and swap the pixel art for an approved pre-rendered 3D cat.

**Architecture:** Pure logic (pose, outfit, reaction, asset path) lives in `src/mascot/mascot.ts` and is checked by a bun self-check script. One React component `CatMascot` renders the cat everywhere (notch wing, agent panel, desktop window). Assets resolve through `public/cat/manifest.json`; anything missing falls back to today's `public/mascot/*.svg`, so code ships before the 3D renders exist. The desktop cat is a new small transparent Tauri window `cat`.

**Tech Stack:** React 19 + TypeScript + framer-motion, Tauri 2 (Rust), bun for self-checks, Blender for the 3D renders (animated WebP output).

**Spec:** `docs/superpowers/specs/2026-11-23-coucou-ozellikleri-design.md` (part 1)

## Global Constraints

- Every user-visible name says CyexsDock, never Nectar. Internal keys keep the `nectar-` prefix (existing convention, see memory "names that must not be renamed").
- The cat is the brand cat of `public/cyexsdock.png`: white, round head, black eyes, ":3" mouth. Not pixel art: pre-rendered 3D (Blender), animated WebP.
- All cat animations together: < 15 MB. Animation stops while not visible.
- 4-6 outfits. Auto outfit: October witch hat, December Santa hat, Ramazan and Kurban Bayramı days bayram outfit (dates from `turkishHolidays` in `src/localCalendar.ts`).
- Setting "Kediyi göster" in Settings > Notch, default on. Key `nectar-cat-visible`.
- Desktop cat hides while a fullscreen app is in front.
- Until the 3D cat is approved, the pixel SVGs stay as fallback.
- UI strings in `src/locales/tr.json` and `src/locales/en.json` (other locales get the English string).

## Review Focus

- Two monitors / DPI scaling: desktop cat saved position off-screen after a monitor is unplugged; expected: cat comes back on the primary monitor (Task 5 test `clampToScreen`).
- Rapid clicking during a reaction: expected: dizzy after exactly 3 clicks within 1500 ms, no stuck state (Task 1 test).
- Missing or partial manifest (an outfit without `music`): expected: fallback to the same pose without outfit, then to pixel SVG — never a broken image (Task 2 test).
- Agent turned on while the cat is on the desktop: expected: notch still shows the agent state; desktop cat mirrors the pose (Task 5).
- Bayram after 2030 (table ends): expected: auto outfit simply never picks bayram, no crash (Task 1 test).

---

### Task 0: Bug — browser video fullscreen stays under the dock

**Reported by the user (2026-11-23):** watching YouTube in the browser and pressing fullscreen, the dock stays visible on top, so the video is not really fullscreen.

**Files:** likely `src-tauri/src/services.rs` (foreground/fullscreen loop ~1170-1450, `dock-fullscreen` event), `src-tauri/src/utils.rs` (`is_window_fullscreen`), `src/Dock.tsx` (listener). Find the real cause first.

- [ ] **Step 1:** Use superpowers:systematic-debugging. Reproduce: Chrome/Edge, YouTube, press `f`. Read how `is_window_fullscreen` decides and why the browser's fullscreen window is not matched (candidates: the window rect vs monitor rect check with DPI scale, the browser using a different top-level window for fullscreen, WS_CAPTION check, the dock being the foreground-walk's first "meaningful" window, the event only reaching one dock). Add a `diagnostics.log` line with the foreground window's class, rect, monitor rect and the decision.
- [ ] **Step 2:** Fix the root cause once in the shared check, so the notch (`notch-fullscreen`) and every dock (primary and secondary) hide.
- [ ] **Step 3:** `cd src-tauri && cargo check` → 0 errors. Ask the user to test YouTube fullscreen in their browser (Claude cannot press fullscreen in the user's browser) and also confirm a maximized (not fullscreen) window still keeps the dock as before.
- [ ] **Step 4: Commit** — `fix(dock): hide under browser fullscreen video`

---

### Task 1: Cat logic module

**Files:**
- Create: `src/mascot/mascot.ts`
- Test: `scripts/selfcheck-mascot.ts`

**Interfaces:**
- Produces:
  - `type CatPose = "idle" | "working" | "needs-input" | "done" | "error" | "music" | "sleeping"`
  - `type CatReaction = "pet" | "dizzy" | "hearts"`
  - `type OutfitId = "none" | "witch" | "santa" | "bayram"` (more added with assets)
  - `const OUTFITS: OutfitId[]`
  - `catPose(input: { agent: AgentState | null; music: boolean; idleMs: number }): CatPose` — agent wins (map like `MASCOT` in `AgentStatus.tsx`), then music, then `sleeping` when `idleMs >= SLEEP_AFTER_MS` (10 min), else `idle`.
  - `autoOutfit(date: Date): OutfitId`
  - `resolveOutfit(setting: string | null, date: Date): OutfitId` — `"auto"`/null → `autoOutfit`, unknown id → `"none"`.
  - `clickReaction(clickTimes: number[], now: number): CatReaction` — `"dizzy"` when 3 clicks within `DIZZY_WINDOW_MS` = 1500, else `"pet"` (the cat is being petted: closes its eyes happily, leans into the touch, a small heart).
  - `HEARTS_HOVER_MS = 2000`

- [ ] **Step 1: Write the failing self-check** (same `eq` helper style as `scripts/selfcheck-calendar.ts`)

```ts
eq(catPose({ agent: "needs_input", music: true, idleMs: 0 }), "needs-input", "agent wins");
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
eq(clickReaction([0, 500, 1000], 1000), "dizzy", "3 fast clicks");
eq(clickReaction([0, 1000, 2000], 2000), "pet", "3 slow clicks");
eq(clickReaction([1000], 1000), "pet", "1 click");
console.log("selfcheck-mascot OK");
```

Check the 2026 bayram dates against the table in `src/localCalendar.ts:150-190` before running; fix the test dates if the table differs.

- [ ] **Step 2: Run, expect FAIL** — `bun scripts/selfcheck-mascot.ts` → module not found.
- [ ] **Step 3: Implement `src/mascot/mascot.ts`** — `autoOutfit` uses `turkishHolidays(date.getFullYear())` and checks whether `date` falls on a "Bayramı" day; bayram beats month rules.
- [ ] **Step 4: Run, expect `selfcheck-mascot OK`.**
- [ ] **Step 5: Commit** — `git add src/mascot scripts/selfcheck-mascot.ts && git commit -m "feat(cat): pose, outfit and reaction logic"`

---

### Task 2: Asset resolver with pixel fallback

**Files:**
- Modify: `src/mascot/mascot.ts`
- Create: `public/cat/manifest.json` (content `{ "outfits": {} }`)
- Test: `scripts/selfcheck-mascot.ts`

**Interfaces:**
- Consumes: `CatPose`, `CatReaction`, `OutfitId` (Task 1)
- Produces:
  - `type CatManifest = { outfits: Partial<Record<OutfitId, string[]>> }` — list of available clip names per outfit, e.g. `{"none": ["idle","idle-left","idle-right","pet"]}`
  - `catSrc(m: CatManifest, outfit: OutfitId, clip: CatPose | CatReaction | "idle-left" | "idle-right", sit?: boolean): string` — order: `/cat/<outfit>/<clip>.webp` → `/cat/none/<clip>.webp` → `/mascot/<pose>[-sit].svg` (reactions and look clips fall back to the `idle` SVG).
  - `useCatManifest(): CatManifest` — fetches `/cat/manifest.json` once, `{outfits:{}}` on error.

- [ ] **Step 1: Add failing checks**

```ts
const m = { outfits: { none: ["idle", "pet"], santa: ["idle"] } };
eq(catSrc(m, "santa", "idle"), "/cat/santa/idle.webp", "outfit clip");
eq(catSrc(m, "santa", "pet"), "/cat/none/pet.webp", "fallback to no outfit");
eq(catSrc(m, "witch", "music"), "/mascot/music.svg", "fallback to pixel");
eq(catSrc(m, "witch", "hearts"), "/mascot/idle.svg", "reaction pixel fallback");
eq(catSrc({ outfits: {} }, "none", "working", true), "/mascot/working-sit.svg", "sit variant");
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `catSrc`, `useCatManifest`, add manifest file.**
- [ ] **Step 4: Run, expect OK.**
- [ ] **Step 5: Commit** — `feat(cat): asset resolver with pixel fallback`

---

### Task 3: `CatMascot` in the notch + "Kediyi göster" setting + reactions

**Files:**
- Create: `src/components/CatMascot.tsx`
- Modify: `src/components/AgentStatus.tsx` (`AgentMascot` and the panel image use `CatMascot`)
- Modify: `src/App.tsx` (left wing fallback at ~line 2585 where it returns `null`; settings sync map ~line 1060)
- Modify: `src/settings/useSettings.ts`, `src/settings/NotchTab.tsx`, `src/settings/searchIndex.ts`
- Modify: `src/locales/*.json`, `src/App.css`

**Interfaces:**
- Consumes: Tasks 1-2
- Produces: `CatMascot(props: { pose: CatPose; outfit: OutfitId; sit?: boolean; size: number; interactive?: boolean; onContextMenu?: (e: React.MouseEvent) => void; onDragOut?: (screenX: number, screenY: number) => void; look?: "left" | "center" | "right" })`

Behaviour:
- Left wing: when the current branch would render `null` and `nectar-cat-visible !== "false"`, render `CatMascot` with `catPose({agent: agentActivity?.state ?? null, music: isMusicMode && !settingsVisualizerEnabled, idleMs})`. `idleMs` from last pointer/keyboard activity (reuse an existing idle source if `App.tsx` has one; else `Date.now() - lastHover`).
- Click → `clickReaction` clip for ~1.2 s then back. Hover 2000 ms → `hearts`. Reactions play only when `interactive`.
- `<img>` is unmounted / `display:none` while the notch window is hidden, so the WebP stops.
- Setting row in the notch section of `NotchTab.tsx`: label "Kediyi göster" / "Show the cat", key `nectar-cat-visible`, default on, added to the sync map and `searchIndex.ts`.

- [ ] **Step 1:** Build the component and wiring.
- [ ] **Step 2: Verify types** — `npm run build` → exits 0.
- [ ] **Step 3: Verify in the app** — `npm run tauri dev`; with no agent and no music the pixel cat shows in the left wing; click → pet fallback (idle SVG ok until assets), 3 fast clicks → dizzy, toggle setting off → cat disappears without restart; agent mode still shows agent pose.
- [ ] **Step 4: Commit** — `feat(cat): show the cat in the notch with reactions`

---

### Task 4: Wardrobe

**Files:**
- Create: `src/components/CatWardrobe.tsx`
- Modify: `src/App.tsx`, `src/locales/*.json`

**Interfaces:**
- Consumes: `OUTFITS`, `resolveOutfit`, `catSrc`, `CatMascot.onContextMenu`
- Produces: setting key `nectar-cat-outfit` (`"auto"` default, or an `OutfitId`), read via the sync map so the desktop window updates too.

Behaviour: right-click the cat → small popover above the cat with "Otomatik" + one thumbnail per outfit (idle clip of that outfit). Hover a thumbnail → cat previews it; click → saves; leaving the popover without a click → back to the saved outfit. `Esc` closes. Keyboard-reachable buttons with `aria-label`s.

- [ ] **Step 1:** Build it.
- [ ] **Step 2:** `npm run build` → 0.
- [ ] **Step 3:** In app: right-click opens, hover previews, click persists across restart, "Otomatik" in October shows witch (temporarily fake the date in devtools: `resolveOutfit("auto", new Date(2026,9,1))`).
- [ ] **Step 4: Commit** — `feat(cat): wardrobe`

---

### Task 5: Desktop cat window

**Files:**
- Create: `cat.html`, `src/cat-main.tsx`, `src/CatDesktop.tsx`
- Modify: `vite.config.ts` (add `cat: "cat.html"` to `rollupOptions.input`)
- Modify: `src-tauri/src/on_demand_windows.rs` (new spec `CAT`), `src-tauri/src/commands.rs` + `main.rs` (commands), `src-tauri/src/services.rs:1414,1445` (also emit `notch-fullscreen` to label `cat`)
- Modify: `src/App.tsx` (drag-out from notch), `src/mascot/mascot.ts` (+`clampToScreen`)
- Test: `scripts/selfcheck-mascot.ts`

**Interfaces:**
- Produces:
  - Rust commands `cat_to_desktop(x: f64, y: f64)`, `cat_to_notch()`; window label `"cat"`, 140×160 logical, transparent, no decorations, always on top, skip taskbar, no shadow, not focused on show.
  - Setting key `nectar-cat-desktop`: `null` or `{ "x": number, "y": number }` (logical px). Startup: if set, open the cat window there.
  - `clampToScreen(p: {x:number;y:number}, screens: {x:number;y:number;w:number;h:number}[], size: {w:number;h:number}): {x:number;y:number}` — inside some screen → unchanged; else top-left of the first screen + 40 px.
  - While on the desktop, the notch wing shows no cat (agent state still shows).

- [ ] **Step 1: Failing check**

```ts
const scr = [{ x: 0, y: 0, w: 1920, h: 1080 }];
eq(clampToScreen({ x: 100, y: 100 }, scr, { w: 140, h: 160 }), { x: 100, y: 100 }, "on screen");
eq(clampToScreen({ x: 3000, y: 100 }, scr, { w: 140, h: 160 }), { x: 40, y: 40 }, "monitor unplugged");
```

- [ ] **Step 2: Run, expect FAIL; implement `clampToScreen`; run, expect OK.**
- [ ] **Step 3: Window + commands.** Drag out: in `CatMascot`, pointer down + move > 24 px outside the notch rect → `invoke("cat_to_desktop", {x, y})` at the pointer. In the cat window: drag uses `getCurrentWindow().startDragging()`, save the position on move end; click → `clickReaction`; right-click → `CatWardrobe`; double-click → `invoke("cat_to_notch")` and set `nectar-cat-desktop` to null. Eyes follow the cursor: poll `cursorPosition()` from `@tauri-apps/api/window` every 250 ms while visible, pick `idle-left` / `idle` / `idle-right` by cursor x relative to the window centre (± 80 px dead zone). Listen to `notch-fullscreen`: true → hide, false → show.
- [ ] **Step 4:** `npm run build` → 0; `cd src-tauri && cargo check` → 0 errors.
- [ ] **Step 5: In app:** drag cat out → it stays on the desktop, survives restart, hides when a YouTube video goes fullscreen, double-click returns it, unplug-simulation: edit the saved x to 5000 → restart → cat on screen.
- [ ] **Step 6: Commit** — `feat(cat): desktop cat window`

---

### Task 6: 3D cat — model and preview (USER CHECKPOINT)

**Files:**
- Create: `art/cat/cat.blend`, `art/cat/README.md` (how to re-render), `art/cat/preview.png`

Load `ajan-ekosistemi:ajan-ekibi` first (Blender agent rules). Model the brand cat from `public/cyexsdock.png` in Blender: soft, rounded, Pixar-like, white fur shading, black glossy eyes, pink cheeks, ":3" mouth, small paws; neutral 3/4-front camera, transparent background, soft studio light.

- [ ] **Step 1:** Build the model, render `art/cat/preview.png` (idle pose, 512×512) and one turntable GIF.
- [ ] **Step 2: STOP. Show the preview to the user and wait for approval.** Changes go back to Step 1. Nothing in Task 7 starts before approval.
- [ ] **Step 3: Commit** — `art(cat): 3D cat model`

---

### Task 7: Render all clips and outfits

**Files:**
- Create: `art/cat/render.py` (Blender batch script), `public/cat/<outfit>/<clip>.webp`
- Modify: `public/cat/manifest.json`

Clips per outfit: `idle, idle-left, idle-right, working, needs-input, done, error, music, sleeping, pet, dizzy, hearts` (12). Outfits: `none, witch, santa, bayram` (+ up to 2 more if budget allows). Output: animated WebP, 160×184 px (2× of the 80×92 display size), 24 fps, loops seamless; reactions ~1.2 s non-looping.

- [ ] **Step 1:** Write `render.py` (renders PNG frames per clip/outfit, encodes with `img2webp` or ffmpeg `libwebp_anim`).
- [ ] **Step 2:** Render; write the manifest listing every produced clip.
- [ ] **Step 3: Verify budget** — `du -sh public/cat` → < 15 MB. Over budget: lower quality / fps before dropping outfits.
- [ ] **Step 4: Verify in app** — every pose, reaction, outfit and look direction shows the 3D cat; no pixel fallback left except clips intentionally missing.
- [ ] **Step 5: Commit** — `art(cat): 3D renders`

---

### Task 8: Final check

- [ ] `bun scripts/selfcheck-mascot.ts`, `bun scripts/selfcheck-calendar.ts` → OK.
- [ ] `npm run build` → 0; `cd src-tauri && cargo check` → 0 errors.
- [ ] Measure idle RAM/CPU with `scripts/measure-ram.ps1` before/after; cat must not raise idle CPU noticeably.
- [ ] Release follows the existing steps (memory "CyexsDock gotchas"); only when the user asks.
