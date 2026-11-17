import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { useT } from "./i18n";
import { Stack, StackEntry, STACK_LIMIT, stackName } from "./stacks";

export function FolderIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillOpacity="0.85" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.2h8.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
    </svg>
  );
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && name.length - dot <= 5 ? name.slice(dot + 1).toUpperCase() : "";
};

/** Grid of the folder's newest items. Lives inside the dock's `.context-menu` panel, so positioning and click-through come from there. */
export function StackPopup({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<StackEntry[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const dragIcon = useRef<string | null>(null);
  const press = useRef<{ x: number; y: number; entry: StackEntry } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setMissing(false);
    invoke<StackEntry[]>("list_folder_entries", { path: stack.path, sort: stack.sort, limit: STACK_LIMIT })
      .then((list) => {
        if (!alive) return;
        setEntries(list);
        list.filter((e) => !e.isDir).forEach((e) => {
          invoke<string | null>("shelf_thumbnail", { path: e.path })
            .then((thumb) => { if (alive && thumb) setThumbs((prev) => ({ ...prev, [e.path]: thumb })); })
            .catch(() => {});
        });
      })
      .catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [stack.path, stack.sort]);

  useEffect(() => {
    invoke<string | null>("shelf_drag_icon").then((icon) => { dragIcon.current = icon; }).catch(() => {});
    // Escape needs keyboard focus, the dock window normally never takes it.
    invoke("set_window_keyboard_focus", { enabled: true }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      invoke("set_window_keyboard_focus", { enabled: false }).catch(() => {});
    };
  }, []);

  const open = (path: string) => {
    invoke("shelf_open", { path }).catch(() => {});
    onClose();
  };

  const beginDrag = async (entry: StackEntry) => {
    const icon = thumbs[entry.path] ?? dragIcon.current;
    if (!icon) return;
    dragged.current = true;
    try { await startDrag({ item: [entry.path], icon, mode: "copy" }); } catch { /* drag cancelled or refused */ }
  };

  return (
    <div className="stack-popup">
      <div className="stack-header">
        <span className="stack-title" title={stack.path}>{stackName(stack.path)}</span>
        <button type="button" className="stack-open-btn" onClick={() => open(stack.path)}>{t("stack.openInExplorer")}</button>
      </div>
      {missing ? (
        <div className="stack-empty">{t("stack.notFound")}</div>
      ) : entries && entries.length === 0 ? (
        <div className="stack-empty">{t("stack.empty")}</div>
      ) : (
        <div className="stack-grid">
          {(entries ?? []).map((entry) => {
            const thumb = thumbs[entry.path];
            return (
              <div
                key={entry.path}
                className="stack-item"
                title={entry.name}
                onPointerDown={(e) => { dragged.current = false; press.current = { x: e.clientX, y: e.clientY, entry }; }}
                onPointerMove={(e) => {
                  const p = press.current;
                  if (!p || !(e.buttons & 1) || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
                  press.current = null;
                  beginDrag(p.entry);
                }}
                onPointerUp={() => { press.current = null; }}
                onClick={() => { if (!dragged.current) open(entry.path); dragged.current = false; }}
              >
                <div className="stack-thumb">
                  {entry.isDir ? <FolderIcon size={34} /> : thumb ? <img src={thumb} alt="" draggable={false} /> : (
                    <span className="stack-glyph">{extOf(entry.name) || "▤"}</span>
                  )}
                </div>
                <span className="stack-name">{entry.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
