import { useEffect, useRef, useState } from "react";
import { catSrc, clickReaction, DIZZY_WINDOW_MS, HEARTS_HOVER_MS, type CatPose, type CatReaction, type OutfitId } from "../mascot/mascot";
import { useCatManifest } from "../mascot/useCatManifest";

const REACTION_MS = 1200;
const SCRATCH_MS = 1800;

export function CatMascot(props: {
  pose: CatPose;
  outfit: OutfitId;
  sit?: boolean;
  size: number;
  interactive?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOut?: (screenX: number, screenY: number) => void; // Task 5: desktop drag-out
  look?: "left" | "center" | "right"; // Task 5: desktop cat looks at the cursor
}) {
  const { pose, outfit, sit, size, interactive, onContextMenu } = props;
  const manifest = useCatManifest();
  const [reaction, setReaction] = useState<CatReaction | null>(null);
  const [hovered, setHovered] = useState(false);
  const [scratch, setScratch] = useState(false);
  const clicks = useRef<number[]>([]);
  const reactionTimer = useRef<number | undefined>(undefined);

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

  const onClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < DIZZY_WINDOW_MS), now];
    setReaction(clickReaction(clicks.current, now));
    clearTimeout(reactionTimer.current);
    reactionTimer.current = window.setTimeout(() => setReaction(null), REACTION_MS);
  };

  const src = catSrc(manifest, outfit, reaction ?? (scratch ? "idle-scratch" : pose), sit);
  return (
    <img
      className={`cat-mascot${src.endsWith(".svg") ? " pixel" : ""}`}
      src={src}
      alt=""
      draggable={false}
      style={{ height: size }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setReaction((r) => (r === "hearts" ? null : r));
      }}
      onContextMenu={onContextMenu}
    />
  );
}
