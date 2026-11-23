import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { catEngineState, clickReaction, DIZZY_WINDOW_MS, HEARTS_HOVER_MS, resolveOutfit, type CatPose, type CatReaction, type OutfitId } from "../mascot/mascot";
import { CatEngine, PALETTES } from "../mascot/catEngine";

const REACTION_MS = 1200;
const SCRATCH_MS = 1800;
const DRAG_OUT_PX = 24;
const FRAME_MS = 1000 / 30 - 2; // 30 fps cap (rAF timestamps jitter by a ms or two)
const WIDTH = 1.15; // canvas width / height: room for the badge beside the head
const CAT = 0.78; // cat height (ear tip to chin) / canvas height: room for particles
const GAZE = { left: -0.5, center: null, right: 0.5 } as const;

// Cached per setting + local day so turkishHolidays does not run on every render.
let outfitCache = { key: "", value: "none" as OutfitId };
export function catOutfit(saved?: string): OutfitId {
  const setting = saved ?? localStorage.getItem("nectar-cat-outfit");
  const key = `${setting}|${new Date().toDateString()}`;
  if (outfitCache.key !== key) outfitCache = { key, value: resolveOutfit(setting, new Date()) };
  return outfitCache.value;
}

export function CatMascot(props: {
  pose: CatPose;
  outfit: OutfitId;
  sit?: boolean;
  size: number;
  interactive?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOut?: (screenX: number, screenY: number) => void; // notch only: drag the cat onto the desktop
  look?: "left" | "center" | "right"; // desktop cat looks at the cursor
}) {
  // outfit/sit are not drawn yet (outfits come with the drawn wardrobe).
  const { pose, size, onContextMenu, onDragOut, look } = props;
  // Agent poses always win: reactions only while idle, sleeping or listening to music.
  const interactive = props.interactive && (pose === "idle" || pose === "sleeping" || pose === "music");
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CatEngine | null>(null);
  engine.current ??= new CatEngine(PALETTES.white);
  const [reaction, setReaction] = useState<CatReaction | null>(null);
  const [hovered, setHovered] = useState(false);
  const [scratch, setScratch] = useState(false);
  const clicks = useRef<number[]>([]);
  const reactionTimer = useRef<number | undefined>(undefined);
  const dragging = useRef<"armed" | "out" | null>(null);

  useEffect(() => () => clearTimeout(reactionTimer.current), []);

  // One rAF loop per cat, only while mounted and the window is not hidden; capped at 30 fps.
  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const cat = engine.current!;
    const h = size;
    const w = Math.round(size * WIDTH);
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < FRAME_MS) return;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      const dpr = window.devicePixelRatio || 1;
      // Re-size on a DPI change (desktop cat moved to another monitor).
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      cat.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const s = h * CAT;
      cat.draw(ctx, w / 2, h - s / 2 - (h - s) * 0.25, s);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = 0;
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", start);
    };
  }, [size]);

  // Hearts after a steady 2 s hover.
  useEffect(() => {
    if (!interactive || !hovered) return;
    const id = window.setTimeout(() => setReaction((r) => r ?? "hearts"), HEARTS_HOVER_MS);
    return () => clearTimeout(id);
  }, [hovered, interactive]);

  // Idle break: scratch once every random 30-90 s, then back to idle.
  useEffect(() => {
    if (pose !== "idle" || reaction || hovered) {
      setScratch(false);
      return;
    }
    const id = window.setTimeout(() => setScratch(!scratch), scratch ? SCRATCH_MS : 30_000 + Math.random() * 60_000);
    return () => clearTimeout(id);
  }, [pose, reaction, hovered, scratch]);

  // Drag out: once the pointer is DRAG_OUT_PX past the notch edge, hand the cat to the desktop window.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!onDragOut || e.button !== 0) return;
    dragging.current = "armed";
    e.currentTarget.setPointerCapture(e.pointerId);
    // Keeps the notch interactive while the pointer leaves its hit box (backend releases on button up).
    invoke("set_cat_dragging", { active: true }).catch(() => {});
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current !== "armed" || !onDragOut) return;
    const notch = e.currentTarget.closest(".nectar")?.getBoundingClientRect();
    if (!notch) return;
    const dx = Math.max(notch.left - e.clientX, 0, e.clientX - notch.right);
    const dy = Math.max(notch.top - e.clientY, 0, e.clientY - notch.bottom);
    if (Math.hypot(dx, dy) <= DRAG_OUT_PX) return;
    dragging.current = "out";
    invoke("set_cat_dragging", { active: false }).catch(() => {});
    onDragOut(e.screenX, e.screenY);
  };
  const onPointerUp = () => {
    // Keep "out" until the click that follows this release has been swallowed.
    if (dragging.current === "armed") {
      dragging.current = null;
      invoke("set_cat_dragging", { active: false }).catch(() => {});
    }
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragging.current === "out") {
      dragging.current = null;
      return;
    }
    if (!interactive) return;
    e.stopPropagation();
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < DIZZY_WINDOW_MS), now];
    setReaction(clickReaction(clicks.current, now));
    clearTimeout(reactionTimer.current);
    reactionTimer.current = window.setTimeout(() => setReaction(null), REACTION_MS);
  };

  const shown = interactive ? reaction : null;
  const state = catEngineState(pose);
  const wasDizzy = useRef(false);
  useEffect(() => engine.current!.setState(state), [state]);
  useEffect(() => {
    engine.current!.music = pose === "music";
  }, [pose]);
  useEffect(() => {
    const cat = engine.current!;
    if (shown === "dizzy") cat.setState("dizzy");
    else if (wasDizzy.current) cat.setState(state);
    if (shown && shown !== "dizzy") cat.react(shown);
    wasDizzy.current = shown === "dizzy";
    // Only a new reaction replays; a pose change is handled above.
  }, [shown]);
  useEffect(() => {
    if (scratch) engine.current!.react("scratch");
  }, [scratch]);
  useEffect(() => {
    engine.current!.gaze = GAZE[look ?? "center"];
  }, [look]);

  return (
    <canvas
      ref={canvas}
      className="cat-mascot"
      aria-hidden="true"
      style={{ width: Math.round(size * WIDTH), height: size }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setReaction((r) => (r === "hearts" ? null : r));
      }}
      onContextMenu={onContextMenu}
    />
  );
}
