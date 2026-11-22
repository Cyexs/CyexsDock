import { useEffect, useRef, useState } from "react";
import { catSrc, clickReaction, DIZZY_WINDOW_MS, HEARTS_HOVER_MS, resolveOutfit, type CatPose, type CatReaction, type OutfitId } from "../mascot/mascot";
import { useCatManifest } from "../mascot/useCatManifest";

const REACTION_MS = 1200;
const SCRATCH_MS = 1800;
const DRAG_OUT_PX = 24;

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
  const { pose, outfit, sit, size, onContextMenu, onDragOut, look } = props;
  // Agent poses always win: reactions only while idle, sleeping or listening to music.
  const interactive = props.interactive && (pose === "idle" || pose === "sleeping" || pose === "music");
  const manifest = useCatManifest();
  const [reaction, setReaction] = useState<CatReaction | null>(null);
  const [hovered, setHovered] = useState(false);
  const [scratch, setScratch] = useState(false);
  const clicks = useRef<number[]>([]);
  const reactionTimer = useRef<number | undefined>(undefined);
  const dragging = useRef<"armed" | "out" | null>(null);

  useEffect(() => () => clearTimeout(reactionTimer.current), []);

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
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current !== "armed" || !onDragOut) return;
    const notch = e.currentTarget.closest(".nectar")?.getBoundingClientRect();
    if (!notch) return;
    const dx = Math.max(notch.left - e.clientX, 0, e.clientX - notch.right);
    const dy = Math.max(notch.top - e.clientY, 0, e.clientY - notch.bottom);
    if (Math.hypot(dx, dy) <= DRAG_OUT_PX) return;
    dragging.current = "out";
    onDragOut(e.screenX, e.screenY);
  };
  const onPointerUp = () => {
    // Keep "out" until the click that follows this release has been swallowed.
    if (dragging.current === "armed") dragging.current = null;
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
  const resting = pose === "idle" && look && look !== "center" ? (`idle-${look}` as const) : pose;
  const src = catSrc(manifest, outfit, shown ?? (scratch ? "idle-scratch" : resting), sit);
  return (
    <img
      className={`cat-mascot${src.endsWith(".svg") ? " pixel" : ""}`}
      src={src}
      alt=""
      draggable={false}
      style={{ height: size }}
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
