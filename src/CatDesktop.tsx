// Desktop cat window (label "cat"): the notch cat dragged onto the desktop.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, cursorPosition, getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { CatMascot, catOutfit } from "./components/CatMascot";
import { CatWardrobe, type OutfitSetting } from "./components/CatWardrobe";
import { useT } from "./i18n";
import { clampToScreen, type OutfitId } from "./mascot/mascot";

const SIZE = { w: 140, h: 160 };
const LOOK_POLL_MS = 250;
const LOOK_DEAD_ZONE = 80;
const DRAG_START_PX = 4;
const SAVE_DELAY_MS = 400;

const win = getCurrentWindow();
const savePos = (p: { x: number; y: number }) =>
  invoke("save_setting", { key: "nectar-cat-desktop", value: { x: Math.round(p.x), y: Math.round(p.y) } }).catch(console.error);

export default function CatDesktop() {
  const t = useT();
  const [setting, setSetting] = useState<OutfitSetting>(() => (localStorage.getItem("nectar-cat-outfit") as OutfitSetting) || "auto");
  const [preview, setPreview] = useState<OutfitId | null>(null);
  const [menu, setMenu] = useState(false);
  const [look, setLook] = useState<"left" | "center" | "right">("center");
  const [fullscreen, setFullscreen] = useState(false);
  const [catVisible, setCatVisible] = useState(true);
  const pos = useRef({ x: 0, y: 0 }); // logical, top-left
  const scale = useRef(1);
  const down = useRef<{ x: number; y: number } | null>(null);
  const visible = catVisible && !fullscreen;

  // Mount: pull the saved spot back on screen (monitor unplugged), then show without focus.
  useEffect(() => {
    (async () => {
      scale.current = await win.scaleFactor();
      const at = (await win.outerPosition()).toLogical(scale.current);
      const screens = (await availableMonitors()).map((m) => ({
        x: m.position.x / m.scaleFactor,
        y: m.position.y / m.scaleFactor,
        w: m.size.width / m.scaleFactor,
        h: m.size.height / m.scaleFactor,
      }));
      const p = clampToScreen({ x: at.x, y: at.y }, screens, SIZE);
      if (p.x !== at.x || p.y !== at.y) await win.setPosition(new LogicalPosition(p.x, p.y));
      pos.current = p;
      savePos(p);
      const saved = await invoke<Record<string, unknown>>("load_settings").catch(() => ({} as Record<string, unknown>));
      const shown = saved["nectar-cat-visible"] !== false && saved["nectar-cat-visible"] !== "false";
      setCatVisible(shown);
      if (shown) invoke("on_demand_window_ready").catch(() => {});
    })().catch(console.error);
  }, []);

  // Save the spot once a drag settles.
  useEffect(() => {
    let timer: number | undefined;
    const un = win.onMoved(({ payload }) => {
      pos.current = payload.toLogical(scale.current);
      clearTimeout(timer);
      timer = window.setTimeout(() => savePos(pos.current), SAVE_DELAY_MS);
    });
    const unScale = win.onScaleChanged(({ payload }) => { scale.current = payload.scaleFactor; });
    return () => {
      clearTimeout(timer);
      un.then((f) => f());
      unScale.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unFs = listen<boolean>("notch-fullscreen", (e) => setFullscreen(e.payload));
    const unSet = listen<{ key: string; value: unknown }>("settings-changed", (e) => {
      const { key, value } = e.payload;
      if (key === "nectar-cat-outfit") setSetting((value == null ? "auto" : String(value)) as OutfitSetting);
      if (key === "nectar-cat-visible") setCatVisible(value !== false && value !== "false");
    });
    return () => {
      unFs.then((f) => f());
      unSet.then((f) => f());
    };
  }, []);

  // Hide under fullscreen / when the cat is switched off; show again without taking focus.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (visible) invoke("cat_to_desktop", pos.current).catch(() => {});
    else { setMenu(false); win.hide().catch(() => {}); }
  }, [visible]);

  // Eyes follow the cursor; polled only while the cat is on screen.
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(async () => {
      const c = await cursorPosition().catch(() => null);
      if (!c) return;
      const centre = (pos.current.x + SIZE.w / 2) * scale.current;
      const dx = c.x - centre;
      const zone = LOOK_DEAD_ZONE * scale.current;
      setLook(dx < -zone ? "left" : dx > zone ? "right" : "center");
    }, LOOK_POLL_MS);
    return () => clearInterval(id);
  }, [visible]);

  return (
    <div
      className="cat-desktop"
      onPointerDown={(e) => { if (e.button === 0 && !menu) down.current = { x: e.screenX, y: e.screenY }; }}
      onPointerMove={(e) => {
        const d = down.current;
        if (!d || Math.hypot(e.screenX - d.x, e.screenY - d.y) < DRAG_START_PX) return;
        down.current = null;
        win.startDragging().catch(() => {});
      }}
      onPointerUp={() => { down.current = null; }}
      onDoubleClick={() => invoke("cat_to_notch").catch(console.error)}
    >
      <CatMascot
        pose="idle"
        outfit={preview ?? catOutfit(setting)}
        size={120}
        interactive
        look={look}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
      />
      {menu && (
        <CatWardrobe
          value={setting}
          t={t}
          onPreview={setPreview}
          onClose={() => { setMenu(false); setPreview(null); }}
          onPick={(v) => {
            localStorage.setItem("nectar-cat-outfit", v);
            invoke("save_setting", { key: "nectar-cat-outfit", value: v }).catch(console.error);
            setSetting(v);
            setMenu(false);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}
