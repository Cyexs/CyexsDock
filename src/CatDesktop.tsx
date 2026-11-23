// Desktop cat window (label "cat"): the notch cat dragged onto the desktop.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { availableMonitors, cursorPosition, getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { CatMascot, catOutfit } from "./components/CatMascot";
import { CatWardrobe, type OutfitSetting } from "./components/CatWardrobe";
import { useT } from "./i18n";
import type { AgentState } from "./components/AgentStatus";
import { catPose, clampToScreen, SLEEP_AFTER_MS, type OutfitId } from "./mascot/mascot";

const SIZE = { w: 140, h: 160 };
const POLL_MS = 100; // fast enough that a click right after reaching the cat lands on it
const HIT_PAD = 6;
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
  // Agent + music come from the notch (App.tsx "cat-pose"); idle/sleep is this cat's own hover.
  const [mirror, setMirror] = useState<{ agent: AgentState | null; music: boolean }>({ agent: null, music: false });
  const [idleMs, setIdleMs] = useState(0);
  const [touched, setTouched] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);
  const pos = useRef({ x: 0, y: 0 }); // logical, top-left
  const scale = useRef(1);
  const down = useRef<{ x: number; y: number } | null>(null);
  const dragUntil = useRef(0); // the OS drag loop sends no pointerup, so "dragging" lasts until moves settle
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
      invoke(shown ? "on_demand_window_ready" : "cat_set_hidden", shown ? undefined : { hidden: true }).catch(() => {});
    })().catch(console.error);
  }, []);

  // Save the spot once a drag settles.
  useEffect(() => {
    const un = win.onMoved(({ payload }) => {
      pos.current = payload.toLogical(scale.current);
      dragUntil.current = Date.now() + SAVE_DELAY_MS;
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => savePos(pos.current), SAVE_DELAY_MS);
    });
    const unScale = win.onScaleChanged(({ payload }) => { scale.current = payload.scaleFactor; });
    return () => {
      clearTimeout(saveTimer.current);
      un.then((f) => f());
      unScale.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const unFs = listen<boolean>("notch-fullscreen", (e) => setFullscreen(e.payload));
    const unPose = listen<{ agent: AgentState | null; music: boolean }>("cat-pose", (e) => setMirror(e.payload));
    unPose.then(() => emitTo("main", "cat-pose-request").catch(() => {}));
    const unSet = listen<{ key: string; value: unknown }>("settings-changed", (e) => {
      const { key, value } = e.payload;
      if (key === "nectar-cat-outfit") setSetting((value == null ? "auto" : String(value)) as OutfitSetting);
      if (key === "nectar-cat-visible") setCatVisible(value !== false && value !== "false");
    });
    return () => {
      unFs.then((f) => f());
      unPose.then((f) => f());
      unSet.then((f) => f());
    };
  }, []);

  // Hide under fullscreen / when the cat is switched off; show again without taking focus.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!visible) setMenu(false);
    invoke("cat_set_hidden", { hidden: !visible }).catch(() => {});
  }, [visible]);

  // Sleeps after SLEEP_AFTER_MS without a hover or click on the cat.
  useEffect(() => {
    setIdleMs(0);
    const id = window.setTimeout(() => setIdleMs(SLEEP_AFTER_MS), SLEEP_AFTER_MS);
    return () => clearTimeout(id);
  }, [touched]);

  // Eyes follow the cursor, and the empty margin lets clicks through to the app below; polled only while on screen.
  const menuOpen = useRef(menu);
  menuOpen.current = menu;
  useEffect(() => {
    if (!visible) return;
    let ignoring = false;
    let cancelled = false;
    // A late tick from a previous run may have left the window ignoring the mouse.
    invoke("set_ignore_cursor_events", { ignore: false }).catch(() => {});
    const id = window.setInterval(async () => {
      const c = await cursorPosition().catch(() => null);
      if (!c || cancelled) return;
      const centre = (pos.current.x + SIZE.w / 2) * scale.current;
      const dx = c.x - centre;
      const zone = LOOK_DEAD_ZONE * scale.current;
      setLook(dx < -zone ? "left" : dx > zone ? "right" : "center");
      const r = document.querySelector(".cat-mascot")?.getBoundingClientRect();
      const lx = c.x / scale.current - pos.current.x;
      const ly = c.y / scale.current - pos.current.y;
      const onCat = !!r && lx >= r.left - HIT_PAD && lx <= r.right + HIT_PAD && ly >= r.top - HIT_PAD && ly <= r.bottom + HIT_PAD;
      const ignore = !onCat && !menuOpen.current && !down.current && Date.now() >= dragUntil.current;
      if (ignore !== ignoring) {
        ignoring = ignore;
        invoke("set_ignore_cursor_events", { ignore }).catch(() => {});
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (ignoring) invoke("set_ignore_cursor_events", { ignore: false }).catch(() => {});
    };
  }, [visible]);

  return (
    <div
      className="cat-desktop"
      onPointerEnter={() => setTouched((n) => n + 1)}
      onPointerDown={(e) => { if (e.button === 0 && !menu) down.current = { x: e.screenX, y: e.screenY }; }}
      onPointerMove={(e) => {
        const d = down.current;
        if (!d || Math.hypot(e.screenX - d.x, e.screenY - d.y) < DRAG_START_PX) return;
        down.current = null;
        dragUntil.current = Date.now() + SAVE_DELAY_MS;
        win.startDragging().catch(() => {});
      }}
      onPointerUp={() => { down.current = null; }}
      onDoubleClick={() => {
        clearTimeout(saveTimer.current); // a late save must not overwrite the null cat_to_notch writes
        invoke("cat_to_notch").catch(console.error);
      }}
    >
      {/* Unmounted while hidden so its animation loop stops. */}
      {visible && <CatMascot
        pose={catPose({ agent: mirror.agent, music: mirror.music, idleMs })}
        outfit={preview ?? catOutfit(setting)}
        size={120}
        interactive
        look={look}
        onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
      />}
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
