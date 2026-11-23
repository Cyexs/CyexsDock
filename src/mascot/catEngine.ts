/*!
 * CyexsDock cat mascot engine. Derived from Coucou's Canvas-2D bot engine
 * (windows/src/mochi/engine.ts and windows/src/core/anim.ts): tween system,
 * easings, particle system, eye-shape drawing, yaw/pitch fake-3D projection and
 * shading are reused. The character (cat head, ears, palettes, mouth, paw,
 * stripes) is new; no Coucou artwork, sounds, outfits or Mochi design is used.
 *
 * Original code: MIT License
 *
 * Copyright (c) 2026 Louis Raillé
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// ── anim.ts (easing helpers) ──────────────────────────────────────────────────

export const Ease = {
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  back: (t: number) => {
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  lin: (t: number) => t,
};
type EaseFn = (t: number) => number;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Types ─────────────────────────────────────────────────────────────────────

export type EyeShape =
  | "pill" | "wide" | "dot" | "line" | "flat" | "happy" | "closed"
  | "spiral" | "heart" | "star" | "tired" | "angry";
type MouthShape = "w" | "frown" | "o";
type BadgeKind = "dots" | "bang" | "dot";
type RGB = readonly [number, number, number];
type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn];
type PropKey =
  | "yaw" | "pitch" | "roll" | "tilt" | "open" | "sx" | "sy" | "oy" | "ox"
  | "tint" | "blush" | "es" | "badgeS" | "ear" | "twitch" | "paw";

interface Tween { prop: PropKey; keys: TweenKey[]; index: number; from: number; startMs: number; onComplete?: () => void }
interface Badge { kind: BadgeKind; color: RGB }
interface Particle {
  type: "heart" | "star" | "spark" | "sweat" | "z" | "claw";
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; rot: number; size: number;
}

export type OutfitName = "none" | "witch" | "santa" | "bayram";
export type StateName = "idle" | "working" | "approval" | "error" | "finished" | "sleeping" | "dizzy";

interface StateCfg {
  color: RGB; tint: number; eye: EyeShape; mouth: MouthShape; badge: Badge | null;
  bounces: boolean; breathes: boolean; zz: boolean; wanders: boolean;
}

// ── Cat palettes (new) ────────────────────────────────────────────────────────

export interface Palette {
  top: string; bottom: string; earInner: string; cheek: string;
  ink: string; pupil?: string; mouth: string;
  stripes?: string; muzzle?: string; rim?: string;
}

export const PALETTES: Record<string, Palette> = {
  white: { top: "#FFFFFF", bottom: "#D9DAE0", earInner: "#F6A9BA", cheek: "255,140,165", ink: "#16110F", mouth: "#2A1F1C" },
  black: { top: "#4A4A52", bottom: "#141418", earInner: "#B9707F", cheek: "235,110,140", ink: "#D6E25E", pupil: "#0E0F08", mouth: "#C9C9D2", rim: "rgba(255,255,255,0.28)" },
  ginger: { top: "#FFC978", bottom: "#E58A35", earInner: "#F5A89C", cheek: "255,120,110", ink: "#1C120B", mouth: "#4A2A18", stripes: "rgba(190,95,25,0.55)", muzzle: "#FFF3E2" },
  tabby: { top: "#ABA091", bottom: "#75695D", earInner: "#E3A1A8", cheek: "240,130,140", ink: "#15100C", mouth: "#3A2E26", stripes: "rgba(60,48,38,0.75)", muzzle: "#EFE8DE" },
  grey: { top: "#C3C8D1", bottom: "#868C98", earInner: "#EEA8B7", cheek: "255,135,160", ink: "#14161B", mouth: "#2B2D33" },
};

// ── Constants ─────────────────────────────────────────────────────────────────

const EYE_W = 0.27;
const EYE_H = 0.29;
const EYE_SP = 0.44;
const EYE_P = -0.02;
const HEAD_RX = 1.1;
const HEAD_RY = 0.9;
/** Hats sit at this pitch offset on the head "sphere" (the crown, just in front of the ear line). */
const CROWN = 1.15;
/** Cat height (ear tip to chin) in units of R. */
export const CAT_H = 2.38;

const C = {
  idle: [0.902, 0.914, 0.933] as RGB,
  working: [0.231, 0.62, 1] as RGB,
  approval: [0.961, 0.647, 0.141] as RGB,
  error: [0.957, 0.314, 0.369] as RGB,
  finished: [0.204, 0.831, 0.6] as RGB,
  sleeping: [0.58, 0.635, 0.722] as RGB,
  dizzy: [0.957, 0.447, 0.714] as RGB,
};
const base = { bounces: false, breathes: false, zz: false, wanders: false, mouth: "w" as MouthShape };

const STATES: Record<StateName, StateCfg> = {
  idle: { ...base, color: C.idle, tint: 0, eye: "pill", badge: null, breathes: true, wanders: true },
  working: { ...base, color: C.working, tint: 0.5, eye: "pill", badge: { kind: "dots", color: C.working } },
  approval: { ...base, color: C.approval, tint: 0.55, eye: "wide", mouth: "o", badge: { kind: "bang", color: C.approval }, bounces: true },
  error: { ...base, color: C.error, tint: 0.55, eye: "flat", mouth: "frown", badge: { kind: "dot", color: C.error } },
  finished: { ...base, color: C.finished, tint: 0.25, eye: "happy", badge: { kind: "dot", color: C.finished } },
  sleeping: { ...base, color: C.sleeping, tint: 0.2, eye: "closed", badge: null, breathes: true, zz: true },
  dizzy: { ...base, color: C.dizzy, tint: 0.5, eye: "spiral", badge: null },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const now = () => performance.now() / 1000;
const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function roundRectPath(x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) {
  const r = Math.max(0, Math.min(R, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

function heartPath(x: CanvasRenderingContext2D, s: number) {
  x.beginPath();
  x.moveTo(0, s * 0.38);
  x.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38);
  x.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38);
  x.closePath();
}

function starPath(x: CanvasRenderingContext2D, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
}

/** Rounded triangle (cat ear), base on y=0, tip at (tipX, -h). */
function earPath(x: CanvasRenderingContext2D, bw: number, h: number, tipX: number, r: number) {
  const ax = -bw / 2, bx = bw / 2;
  x.beginPath();
  x.moveTo(0, h * 0.35);
  x.lineTo(ax, h * 0.35);
  x.arcTo(ax, 0, tipX, -h, r * 0.6);
  x.arcTo(tipX, -h, bx, 0, r);
  x.arcTo(bx, 0, bx, h * 0.35, r * 0.6);
  x.lineTo(bx, h * 0.35);
  x.closePath();
}

const FONT = `system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif`;

// ── Engine ────────────────────────────────────────────────────────────────────

export class CatEngine {
  pal: Palette;

  yaw = 0; pitch = 0; roll = 0; tilt = 0; open = 1;
  sx = 1; sy = 1; oy = 0; ox = 0;
  tint = 0; blush = 0; es = 1; badgeS = 0;
  /** −1 = ears flat (angry), 0 = normal. */
  ear = 0;
  /** Right ear flick, radians. */
  twitch = 0;
  /** Scratch paw swipe progress 0…1. */
  paw = 0;
  /** Desktop cat: fixed yaw toward the cursor while idle; null = look around on its own. */
  gaze: number | null = null;
  /** Gentle head bob while music plays (state stays idle). */
  music = false;
  /** Hat drawn on the crown (our own designs). */
  outfit: OutfitName = "none";

  tgYaw = 0; tgPitch = 0; tgTilt = 0; tgSy = 1; tgSx = 1; tgEs = 1;
  col: RGB = C.idle; colT: RGB = C.idle;
  state: StateName = "idle";
  cfg: StateCfg = STATES.idle;
  eyeOverride: EyeShape | null = null;
  eyeOverrideUntil = 0;
  mouthOverride: MouthShape | null = null;
  badge: Badge | null = null;
  private badgeKey = "none";
  private badgeToken = 0;
  private tweens = new Map<PropKey, Tween>();
  private locks = new Set<PropKey>();
  private particles: Particle[] = [];
  private t0 = now() - Math.random() * 5;
  private nextBlink = now() + 1.5 + Math.random() * 2;
  private lastAmbient = 0;
  private look = { x: 0, y: 0 };
  private lookNext = 0;
  private emoteToken = 0;
  /** Notch-sized cat: particles rise less and fade faster so the canvas top does not cut them. */
  private small = false;

  constructor(pal: Palette) { this.pal = pal; }

  // ── Public API ──────────────────────────────────────────────────────────────

  setState(next: StateName) {
    this.clearEmote();
    this.state = next;
    this.cfg = STATES[next];
    this.colT = this.cfg.color;
    this.tint = this.cfg.tint;
    this.setBadge(this.cfg.badge);
    switch (next) {
      case "finished":
        this.anim("oy", [[-0.25, 160, Ease.out], [0, 380, Ease.back]]);
        this.squash();
        setTimeout(() => this.emit("spark", 5), 250);
        break;
      case "error":
        this.anim("ox", [[0.08, 50, Ease.out], [-0.08, 70, Ease.inOut], [0.05, 70, Ease.inOut], [0, 90, Ease.out]]);
        this.anim("ear", [[-0.6, 160, Ease.out]]);
        break;
      case "approval":
        this.anim("oy", [[-0.2, 150, Ease.out], [0, 300, Ease.back]]);
        break;
      case "dizzy":
        this.anim("roll", [[Math.PI * 4, 1300, Ease.inOut]], () => { this.roll = 0; });
        break;
      default:
        this.blink();
    }
    if (next !== "error") this.anim("ear", [[0, 220, Ease.out]]);
  }

  /** Reactions that are not states: they play over the current state. */
  react(kind: "pet" | "angry" | "hearts" | "scratch") {
    const t = now();
    const tok = ++this.emoteToken;
    const done = (ms: number) => setTimeout(() => {
      if (tok !== this.emoteToken) return;
      this.mouthOverride = null;
      this.anim("ear", [[0, 260, Ease.out]]);
    }, ms);
    switch (kind) {
      case "pet":
        this.eyeOverride = "happy"; this.eyeOverrideUntil = t + 2.0;
        this.anim("tilt", [[-0.2, 260, Ease.out], [-0.2, 1300, Ease.lin], [0, 380, Ease.inOut]]);
        this.anim("ear", [[-0.35, 220, Ease.out]]);
        this.anim("blush", [[1, 250, Ease.out], [1, 1300, Ease.lin], [0, 400, Ease.inOut]]);
        this.anim("sy", [[0.93, 200, Ease.out], [1.02, 300, Ease.inOut], [0.96, 400, Ease.inOut], [1, 400, Ease.back]]);
        this.anim("sx", [[1.05, 200, Ease.out], [0.99, 300, Ease.inOut], [1.03, 400, Ease.inOut], [1, 400, Ease.back]]);
        setTimeout(() => { if (tok === this.emoteToken) this.emit("heart", 1); }, 350);
        done(2000);
        break;
      case "angry":
        this.eyeOverride = "angry"; this.eyeOverrideUntil = t + 2.2;
        this.mouthOverride = "frown";
        this.anim("ear", [[-1, 140, Ease.out]]);
        this.anim("ox", [[0.07, 45, Ease.out], [-0.07, 60, Ease.inOut], [0.06, 60, Ease.inOut], [-0.04, 60, Ease.inOut], [0, 80, Ease.out]]);
        this.anim("sy", [[0.9, 120, Ease.out], [1, 300, Ease.back]]);
        this.anim("tint", [[0.6, 150, Ease.out], [0.6, 1800, Ease.lin], [this.cfg.tint, 300, Ease.inOut]]);
        this.colT = C.error;
        setTimeout(() => { if (tok === this.emoteToken) this.colT = this.cfg.color; }, 2200);
        done(2200);
        break;
      case "hearts":
        this.eyeOverride = "heart"; this.eyeOverrideUntil = t + 1.8;
        this.anim("blush", [[1, 300, Ease.out], [1, 1200, Ease.lin], [0, 300, Ease.inOut]]);
        this.anim("oy", [[-0.1, 160, Ease.out], [0, 300, Ease.back]]);
        this.emit("heart", 4);
        break;
      case "scratch": {
        // Ear flick, a quick head shake, then two paw swipes leaving claw marks.
        this.anim("twitch", [[0.45, 60, Ease.out], [-0.1, 90, Ease.inOut], [0.3, 70, Ease.inOut], [0, 120, Ease.out]]);
        this.anim("yaw", [[-0.4, 60, Ease.out], [0.4, 90, Ease.inOut], [-0.25, 80, Ease.inOut], [0, 120, Ease.out]]);
        this.eyeOverride = "line"; this.eyeOverrideUntil = t + 0.35;
        setTimeout(() => {
          if (tok !== this.emoteToken) return;
          this.eyeOverride = "wide"; this.eyeOverrideUntil = now() + 1.0;
          this.anim("paw", [[1, 170, Ease.inOut], [0, 120, Ease.out], [1, 170, Ease.inOut], [0, 220, Ease.out]]);
          setTimeout(() => { if (tok === this.emoteToken) this.emit("claw", 1); }, 170);
          setTimeout(() => { if (tok === this.emoteToken) this.emit("claw", 1); }, 460);
        }, 380);
        break;
      }
    }
  }

  private clearEmote() {
    this.emoteToken++;
    this.eyeOverride = null;
    this.mouthOverride = null;
    for (const p of ["tilt", "blush", "paw", "twitch", "ear"] as PropKey[]) { this.tweens.delete(p); this.locks.delete(p); }
    this.blush = 0; this.paw = 0; this.twitch = 0;
  }

  setBadge(b: Badge | null) {
    const key = b ? `${b.kind}-${b.color.join(",")}` : "none";
    if (key === this.badgeKey) return;
    this.badgeKey = key;
    const tok = ++this.badgeToken;
    this.anim("badgeS", [[0, 90, Ease.inOut]]);
    setTimeout(() => {
      if (tok !== this.badgeToken) return;
      this.badge = b;
      if (b) this.anim("badgeS", [[1, 280, Ease.back]]);
    }, 100);
  }

  blink() {
    if (this.locks.has("open")) return;
    this.anim("open", [[0.06, 70, Ease.inOut], [1, 130, Ease.out]]);
  }

  squash() {
    this.anim("sy", [[0.78, 70, Ease.out], [1.1, 130, Ease.out], [1, 170, Ease.inOut]]);
    this.anim("sx", [[1.16, 70, Ease.out], [0.95, 130, Ease.out], [1, 170, Ease.inOut]]);
  }

  emit(type: Particle["type"], count: number) {
    for (let i = 0; i < count; i++) {
      const isZ = type === "z";
      const isClaw = type === "claw";
      this.particles.push({
        type,
        x: isClaw ? 0.15 + Math.random() * 0.2 : (Math.random() - 0.5) * 0.9 + (isZ ? 0.55 : 0),
        y: isClaw ? -0.05 : -0.8 - Math.random() * 0.2,
        vx: isClaw ? 0 : (Math.random() - 0.5) * 0.35 + (isZ ? 0.18 : 0),
        vy: isClaw ? 0 : -(0.45 + Math.random() * 0.35),
        age: -i * 0.14,
        life: isClaw ? 0.7 : 1.3 + Math.random() * 0.5,
        rot: isClaw ? -0.5 : Math.random() * Math.PI * 2,
        size: isClaw ? 0.5 : 0.15 + Math.random() * 0.08,
      });
    }
  }

  anim(prop: PropKey, keys: TweenKey[], onComplete?: () => void) {
    this.tweens.set(prop, { prop, keys, index: 0, from: this[prop], startMs: performance.now(), onComplete });
    this.locks.add(prop);
  }

  // ── Update ──────────────────────────────────────────────────────────────────

  update(dt: number) {
    const n = now();
    const nowMs = performance.now();

    for (const tw of [...this.tweens.values()]) {
      const k = tw.keys[tw.index];
      const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
      this[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
      if (p >= 1) {
        tw.from = k[0];
        tw.index += 1;
        tw.startMs = nowMs;
        if (tw.index >= tw.keys.length) {
          this.tweens.delete(tw.prop);
          this.locks.delete(tw.prop);
          tw.onComplete?.();
        }
      }
    }

    const t = n - this.t0;
    // Look around (the engine's mini-bot wander, used for the idle cat).
    if (n > this.lookNext) {
      this.look = { x: -0.8 + Math.random() * 1.6, y: -0.45 + Math.random() * 0.8 };
      if (Math.random() < 0.35) this.look = { x: 0, y: 0 };
      this.lookNext = n + 0.8 + Math.random() * 2.2;
    }
    let ty = this.cfg.wanders ? (this.gaze ?? this.look.x * 0.62) : 0;
    let tp = this.cfg.wanders && this.gaze === null ? this.look.y * 0.5 : 0;
    if (this.state === "working") { ty = 0.12 + Math.sin(t * 1.3) * 0.12; tp = -0.22; }
    if (this.state === "sleeping") { ty = 0; tp = -0.18; }
    if (this.state === "dizzy") ty = Math.sin(t * 9) * 0.25;
    this.tgYaw = ty;
    this.tgPitch = tp;
    const bob = this.music && this.state === "idle";
    this.tgTilt = this.state === "sleeping" ? 0.12 : bob ? Math.sin(t * 1.7) * 0.1 : 0;

    const bounce = this.cfg.bounces ? -Math.abs(Math.sin(t * 5.2)) * 0.07 : bob ? -Math.abs(Math.sin(t * 3.4)) * 0.05 : 0;
    const kGen = 1 - Math.pow(0.0008, dt);
    if (!this.locks.has("oy")) this.oy += (bounce - this.oy) * kGen;

    if (this.cfg.breathes) {
      const amp = 0.03;
      this.tgSy = 1 + Math.sin(t * 1.8) * amp;
      this.tgSx = 1 - Math.sin(t * 1.8) * amp * 0.57;
    } else {
      this.tgSy = 1; this.tgSx = 1;
    }

    const kLook = 1 - Math.pow(0.0025, dt);
    if (!this.locks.has("yaw")) this.yaw += (this.tgYaw - this.yaw) * kLook;
    if (!this.locks.has("pitch")) this.pitch += (this.tgPitch - this.pitch) * kLook;
    if (!this.locks.has("tilt")) this.tilt += (this.tgTilt - this.tilt) * kGen;
    if (!this.locks.has("sy")) this.sy += (this.tgSy - this.sy) * kGen;
    if (!this.locks.has("sx")) this.sx += (this.tgSx - this.sx) * kGen;
    if (!this.locks.has("es")) this.es += (this.tgEs - this.es) * kGen;
    this.col = mix3(this.col, this.colT, 1 - Math.pow(0.002, dt));

    if (n > this.nextBlink) {
      if (this.state !== "sleeping" && this.state !== "dizzy") {
        this.blink();
        if (Math.random() < 0.22) setTimeout(() => this.blink(), 230);
      }
      this.nextBlink = n + 2.2 + Math.random() * 3.2;
    }
    if (this.eyeOverride && n > this.eyeOverrideUntil) this.eyeOverride = null;

    if (n - this.lastAmbient > 1.3) {
      this.lastAmbient = n;
      if (this.cfg.zz) this.emit("z", 1);
    }
    for (const p of this.particles) p.age += dt * (this.small ? 1.5 : 1);
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  // ── Draw ────────────────────────────────────────────────────────────────────

  /** Draws the cat with its head centre near (cx, cy); `size` = ear tip to chin, in CSS px. */
  draw(x: CanvasRenderingContext2D, cx0: number, cy0: number, size: number) {
    const R = size / CAT_H;
    this.small = size < 48;
    const rx = R * HEAD_RX;
    const ry = R * HEAD_RY;
    // Head centre sits below the visual centre because the ears stick up.
    const cx = cx0 + this.ox * R;
    const cy = cy0 + R * 0.28 + this.oy * R;

    x.save();
    x.translate(cx, cy);
    x.rotate(this.tilt + this.roll);
    // Squash from the chin, like a soft body.
    x.translate(0, ry);
    x.scale(this.sx, this.sy);
    x.translate(0, -ry);

    this.drawEars(x, R, rx, ry);
    const head = this.headPath(rx, ry);
    this.drawHead(x, head, R, rx, ry);

    x.save();
    x.clip(head);
    this.drawMarkings(x, R, rx, ry);
    this.drawCheeks(x, R, rx, ry);
    this.drawEyes(x, R, rx, ry);
    this.drawMouth(x, R, rx, ry);
    x.restore();

    // After the head so the hat covers the inner ear bases; the ears still show beside it.
    this.drawOutfit(x, R, rx, ry);
    if (this.paw > 0.01) this.drawPaw(x, R);
    x.restore();

    if (this.badge && this.badgeS > 0.01) this.drawBadge(x, this.badge, R, cx, cy);
    this.drawParticles(x, R, cx, cy);
  }

  /** Point on the head "sphere" at (yaw offset, pitch offset): the engine's eye projection. */
  private proj(yawOff: number, pitchOff: number, rx: number, ry: number) {
    const a = yawOff + this.yaw;
    const p = pitchOff + this.pitch;
    const cp = Math.cos(p);
    return {
      x: Math.sin(a) * cp * rx,
      y: -Math.sin(p) * ry,
      fx: Math.max(0.18, Math.cos(a)),
      fy: Math.max(0.18, cp),
      vis: Math.cos(a) * cp,
    };
  }

  private headPath(rx: number, ry: number): Path2D {
    const n = 72;
    const expN = 2.0 / 2.35;
    const p = new Path2D();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let px = rx * (ca >= 0 ? Math.pow(ca, expN) : -Math.pow(-ca, expN));
      const py = ry * (sa >= 0 ? Math.pow(sa, expN) : -Math.pow(-sa, expN));
      // Slightly fuller cheeks in the lower half.
      if (sa > 0) px *= 1 + 0.04 * Math.sin(Math.PI * sa);
      if (i === 0) p.moveTo(px, py); else p.lineTo(px, py);
    }
    p.closePath();
    return p;
  }

  private headGradient(x: CanvasRenderingContext2D, rx: number, ry: number) {
    const g = x.createLinearGradient(rx * 0.7, -ry * 1.3, -rx * 0.8, ry * 0.9);
    g.addColorStop(0, this.pal.top);
    g.addColorStop(1, this.pal.bottom);
    return g;
  }

  private drawEars(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    // Far ear first so the near one overlaps it when turned.
    const order = this.yaw >= 0 ? [-1, 1] : [1, -1];
    for (const sd of order) {
      const ey = sd * 0.56 + this.yaw * 0.9;
      const face = Math.cos(ey);
      const bx = Math.sin(ey) * rx * 0.8;
      const by = -ry * 0.7 + this.pitch * ry * 0.3;
      const bw = R * 0.9 * (0.55 + 0.45 * Math.max(0, face));
      const h = R * 0.84 * (1 - this.pitch * 0.35) * (1 + this.ear * 0.25);
      const rot = sd * (0.22 - this.ear * 0.75) + this.yaw * 0.25 + (sd > 0 ? this.twitch : 0);

      x.save();
      x.translate(bx, by);
      x.rotate(rot);
      const tipX = sd * bw * 0.08;
      earPath(x, bw, h, tipX, R * 0.16);
      x.fillStyle = this.headGradient(x, rx, ry);
      x.fill();
      if (this.pal.rim) { x.strokeStyle = this.pal.rim; x.lineWidth = Math.max(0.6, R * 0.035); x.stroke(); }
      // Inner ear: visible when the ear faces us.
      const innerA = clamp(face * 1.6 - 0.1, 0, 1);
      if (innerA > 0.02) {
        x.globalAlpha = innerA;
        x.translate(Math.sin(this.yaw) * bw * 0.12, -h * 0.02);
        earPath(x, bw * 0.52, h * 0.66, tipX * 0.6, R * 0.1);
        x.fillStyle = this.pal.earInner;
        x.fill();
      }
      x.restore();
    }
  }

  private drawHead(x: CanvasRenderingContext2D, head: Path2D, R: number, rx: number, ry: number) {
    x.fillStyle = this.headGradient(x, rx, ry);
    x.fill(head);

    const effTint = this.tint * 0.55;
    if (effTint > 0.01) {
      const tg = x.createLinearGradient(0, ry, 0, -ry);
      tg.addColorStop(0, rgba(this.col, 0.72 * effTint));
      tg.addColorStop(1, rgba(this.col, 0));
      x.fillStyle = tg;
      x.fill(head);
    }
    // Shading follows the yaw a little, so the turn reads as 3D.
    const sxo = -Math.sin(this.yaw) * rx * 0.25;
    const syo = Math.sin(this.pitch) * ry * 0.25;
    const sh = x.createRadialGradient(sxo, -syo, R * 0.15, sxo, -syo, R * 1.3);
    sh.addColorStop(0, "rgba(0,0,0,0)");
    sh.addColorStop(0.6, "rgba(0,0,0,0)");
    sh.addColorStop(1, "rgba(0,0,0,0.2)");
    x.fillStyle = sh;
    x.fill(head);

    const hl = x.createRadialGradient(rx * 0.34 + sxo, -ry * 0.48 - syo, 0, rx * 0.34 + sxo, -ry * 0.48 - syo, R * 0.5);
    hl.addColorStop(0, "rgba(255,255,255,0.5)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = hl;
    x.fill(head);

    if (this.pal.rim) {
      x.strokeStyle = this.pal.rim;
      x.lineWidth = Math.max(0.6, R * 0.035);
      x.stroke(head);
    }
  }

  private stroke3D(x: CanvasRenderingContext2D, pts: [number, number][], rx: number, ry: number, w: number) {
    const ps = pts.map(([a, p]) => this.proj(a, p, rx, ry));
    if (ps.some((q) => q.vis <= 0.05)) return;
    x.lineWidth = w * ps[0].fx;
    x.beginPath();
    ps.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
    x.stroke();
  }

  private drawMarkings(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    const pal = this.pal;
    if (pal.muzzle) {
      // Pale muzzle: two soft lobes around the mouth.
      for (const sd of [-1, 1]) {
        const q = this.proj(sd * 0.17, -0.3, rx, ry);
        if (q.vis <= 0.05) continue;
        const g = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, R * 0.34);
        g.addColorStop(0, pal.muzzle);
        g.addColorStop(0.65, pal.muzzle);
        g.addColorStop(1, pal.muzzle + "00");
        x.fillStyle = g;
        x.beginPath();
        x.ellipse(q.x, q.y, R * 0.34 * q.fx, R * 0.27 * q.fy, 0, 0, Math.PI * 2);
        x.fill();
      }
    }
    if (pal.stripes) {
      x.strokeStyle = pal.stripes;
      x.lineCap = "round";
      // Forehead "M" stripes.
      for (const a of [-0.2, 0, 0.2]) {
        this.stroke3D(x, [[a, 0.95], [a * 0.8, 0.62]], rx, ry, R * (a === 0 ? 0.11 : 0.085));
      }
      // Cheek stripes.
      for (const sd of [-1, 1]) {
        for (const p of [-0.08, -0.26]) {
          this.stroke3D(x, [[sd * 1.3, p + 0.03], [sd * 1.02, p]], rx, ry, R * 0.075);
        }
      }
    }
  }

  private drawCheeks(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    const a = 0.32 + 0.4 * this.blush;
    for (const sd of [-1, 1]) {
      const q = this.proj(sd * 0.72, -0.24, rx, ry);
      if (q.vis <= 0.05) continue;
      const g = x.createRadialGradient(q.x, q.y, 0, q.x, q.y, R * 0.2);
      g.addColorStop(0, `rgba(${this.pal.cheek},${a})`);
      g.addColorStop(1, `rgba(${this.pal.cheek},0)`);
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(q.x, q.y, R * 0.2 * q.fx, R * 0.13 * q.fy, 0, 0, Math.PI * 2);
      x.fill();
    }
  }

  private drawEyes(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    const shape: EyeShape = this.eyeOverride ?? this.cfg.eye;
    for (const sd of [-1, 1]) {
      const q = this.proj(sd * EYE_SP, EYE_P, rx, ry);
      if (q.vis <= 0.04) continue;
      const ew = R * EYE_W * this.es;
      const eh = R * EYE_H * this.es;
      x.save();
      x.translate(q.x, q.y);
      x.scale(q.fx, q.fy);
      x.fillStyle = this.pal.ink;
      x.strokeStyle = this.pal.ink;
      this.drawEyeShape(x, shape, ew, eh, sd, R);
      x.restore();
    }
  }

  /** Round eye with optional pupil and the white catch-light. */
  private roundEye(x: CanvasRenderingContext2D, w: number, h: number) {
    const hh = Math.max(h * this.open, w * 0.22);
    roundRectPath(x, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2));
    x.fill();
    if (this.pal.pupil && hh > w * 0.5) {
      x.fillStyle = this.pal.pupil;
      x.beginPath();
      x.ellipse(0, 0, w * 0.2, hh * 0.4, 0, 0, Math.PI * 2);
      x.fill();
    }
    if (this.open > 0.6) {
      x.fillStyle = "rgba(255,255,255,0.95)";
      x.beginPath();
      x.arc(w * 0.17, -hh * 0.2, w * 0.17, 0, Math.PI * 2);
      x.fill();
    }
  }

  private drawEyeShape(x: CanvasRenderingContext2D, shape: EyeShape, w: number, h: number, sd: number, R: number) {
    const t = now();
    switch (shape) {
      case "wide": this.roundEye(x, w * 1.14, h * 1.12); break;
      case "pill": this.roundEye(x, w, h); break;
      case "dot":
        x.beginPath(); x.arc(0, 0, w * 0.45, 0, Math.PI * 2); x.fill();
        break;
      case "angry": {
        // Round eye cut by a slanted lid (inner corner low).
        x.save();
        x.beginPath();
        x.moveTo(-w, -h * 0.05 + sd * h * 0.32);
        x.lineTo(w, -h * 0.05 - sd * h * 0.32);
        x.lineTo(w, h);
        x.lineTo(-w, h);
        x.closePath();
        x.clip();
        this.roundEye(x, w, h);
        x.restore();
        break;
      }
      case "line":
        x.rotate(-sd * 0.2);
        roundRectPath(x, -w * 0.7, -w * 0.18, w * 1.4, w * 0.36, w * 0.18);
        x.fill();
        break;
      case "flat":
        roundRectPath(x, -w * 0.65, -w * 0.18, w * 1.3, w * 0.36, w * 0.18);
        x.fill();
        break;
      case "happy":
        x.lineWidth = Math.max(w * 0.38, R * 0.05);
        x.lineCap = "round";
        x.beginPath();
        x.arc(0, h * 0.22, w * 0.62, Math.PI * 1.15, Math.PI * 1.85);
        x.stroke();
        break;
      case "closed":
        x.lineWidth = Math.max(w * 0.3, R * 0.045);
        x.lineCap = "round";
        x.beginPath();
        x.arc(0, -h * 0.12, w * 0.6, Math.PI * 0.18, Math.PI * 0.82);
        x.stroke();
        break;
      case "spiral": {
        x.lineWidth = w * 0.18;
        x.lineCap = "round";
        x.beginPath();
        for (let a = 0; a < 4.4 * Math.PI; a += 0.2) {
          const r = w * 0.05 + a * w * 0.045;
          const aa = a + t * 9 * sd;
          const px = Math.cos(aa) * r;
          const py = Math.sin(aa) * r;
          if (a === 0) x.moveTo(px, py); else x.lineTo(px, py);
        }
        x.stroke();
        break;
      }
      case "heart":
        x.fillStyle = "#FF4D6D";
        heartPath(x, w * 1.15);
        x.fill();
        break;
      case "star":
        x.fillStyle = "#F7B32B";
        x.rotate(t * 1.5 * sd);
        starPath(x, w * 0.95, w * 0.42);
        x.fill();
        break;
      case "tired":
        roundRectPath(x, -w / 2, -h * 0.02, w, h * 0.38, w / 2);
        x.fill();
        break;
    }
  }

  private drawMouth(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    const shape = this.mouthOverride ?? this.cfg.mouth;
    const q = this.proj(0, -0.27, rx, ry);
    if (q.vis <= 0.1) return;
    x.save();
    x.translate(q.x, q.y);
    x.scale(q.fx, q.fy);
    x.strokeStyle = this.pal.mouth;
    x.fillStyle = this.pal.mouth;
    x.lineWidth = Math.max(0.7, R * 0.06);
    x.lineCap = "round";
    x.lineJoin = "round";
    const s = R * 0.1;
    x.beginPath();
    if (shape === "w") {
      // ":3" — two little bumps.
      x.arc(-s, 0, s, Math.PI * 0.05, Math.PI * 0.95);
      x.moveTo(s * 2, 0);
      x.arc(s, 0, s, Math.PI * 0.05, Math.PI * 0.95);
      x.stroke();
    } else if (shape === "frown") {
      x.arc(0, s * 1.1, s * 1.1, Math.PI * 1.2, Math.PI * 1.8);
      x.stroke();
    } else {
      x.ellipse(0, s * 0.4, s * 0.75, s * 0.95, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.restore();
  }

  /**
   * Hat on the crown. It stands on the head's surface normal, so it leans with yaw
   * and pitch; tilt, roll and squash come from the head transform it is drawn in.
   */
  private drawOutfit(x: CanvasRenderingContext2D, R: number, rx: number, ry: number) {
    if (this.outfit === "none") return;
    const a = this.proj(0, CROWN, rx, ry);
    // How much the hat's axis points at us: brims flatten to ellipses, heights shorten.
    const z = Math.cos(this.yaw) * Math.cos(CROWN + this.pitch);
    const flat = clamp(Math.abs(z), 0.14, 0.6);
    const hs = Math.sqrt(1 - clamp(z * z, 0, 0.75));
    const edge = Math.max(0.6, R * 0.035);
    x.save();
    x.translate(a.x, a.y);
    x.rotate(Math.atan2(a.x, -a.y));
    x.lineJoin = "round";
    x.lineCap = "round";
    if (this.outfit === "witch") this.drawWitchHat(x, R, flat, hs, edge);
    else if (this.outfit === "santa") this.drawSantaHat(x, R, flat, hs);
    else this.drawFez(x, R, flat, hs);
    x.restore();
  }

  /** Purple pointed hat, wide brim, orange band, tip bent over to one side. */
  private drawWitchHat(x: CanvasRenderingContext2D, R: number, flat: number, hs: number, edge: number) {
    const bw = R * 0.74, be = bw * flat;
    const cw = R * 0.34, H = R * 1.0 * hs;
    const rim = "rgba(255,255,255,0.28)"; // reads on the black notch and on the black cat
    const brimFill = (front: boolean) => {
      x.beginPath();
      if (front) { x.ellipse(0, 0, bw, be, 0, 0, Math.PI); x.closePath(); } else x.ellipse(0, 0, bw, be, 0, 0, Math.PI * 2);
      x.fillStyle = "#4E2491";
      x.fill();
    };
    brimFill(false);
    x.strokeStyle = rim; x.lineWidth = edge;
    x.stroke();
    const cone = new Path2D();
    cone.moveTo(-cw, 0);
    cone.quadraticCurveTo(-cw * 0.35, -H * 0.55, -cw * 0.05, -H * 0.9);
    cone.quadraticCurveTo(cw * 0.3, -H * 1.06, cw * 0.95, -H * 0.9);
    cone.quadraticCurveTo(cw * 0.3, -H * 0.8, cw * 0.32, -H * 0.62);
    cone.quadraticCurveTo(cw * 0.45, -H * 0.25, cw, 0);
    cone.closePath();
    const g = x.createLinearGradient(cw, -H, -cw, 0);
    g.addColorStop(0, "#9A62E6");
    g.addColorStop(1, "#5A2AA3");
    x.fillStyle = g;
    x.fill(cone);
    x.save();
    x.clip(cone);
    x.fillStyle = "#F29A2E";
    x.fillRect(-cw * 1.2, -H * 0.27, cw * 2.4, H * 0.14);
    x.restore();
    x.strokeStyle = rim;
    x.stroke(cone);
    brimFill(true); // the brim's near half is in front of the cone
    x.beginPath();
    x.ellipse(0, 0, bw, be, 0, 0, Math.PI);
    x.stroke();
  }

  /** Red floppy hat with a fluffy white band and a pompom on the drooping tip. */
  private drawSantaHat(x: CanvasRenderingContext2D, R: number, flat: number, hs: number) {
    const bw = R * 0.5, be = bw * flat;
    const H = R * 0.95 * hs;
    const tip = { x: R * 0.6 * Math.cos(this.yaw), y: -H * 0.6 };
    x.beginPath();
    x.moveTo(-bw * 0.9, 0);
    x.quadraticCurveTo(-bw * 0.55, -H * 1.08, tip.x, tip.y);
    x.quadraticCurveTo(bw * 0.25, -H * 0.55, bw * 0.9, 0);
    x.closePath();
    const g = x.createLinearGradient(bw, -H, -bw, 0);
    g.addColorStop(0, "#F0473F");
    g.addColorStop(1, "#B3161B");
    x.fillStyle = g;
    x.fill();
    // Fluff: a row of overlapping puffs along the band's near half, a soft shadow under each.
    const puff = Math.max(R * 0.12, 0.9);
    for (const [dy, col] of [[R * 0.04, "rgba(0,0,0,0.18)"], [0, "#FFFFFF"]] as const) {
      x.fillStyle = col;
      x.beginPath();
      for (let i = 0; i <= 6; i++) {
        const t = (i / 6) * Math.PI;
        const px = Math.cos(t) * bw, py = Math.sin(t) * be + dy;
        x.moveTo(px + puff, py);
        x.arc(px, py, puff, 0, Math.PI * 2);
      }
      x.fill();
    }
    for (const [dy, col, r] of [[R * 0.03, "rgba(0,0,0,0.18)", R * 0.17], [0, "#FFFFFF", R * 0.16]] as const) {
      x.fillStyle = col;
      x.beginPath();
      x.arc(tip.x, tip.y + dy, Math.max(r, 1.1), 0, Math.PI * 2);
      x.fill();
    }
  }

  /** Bayramlık: a small red fez with a black tassel hanging over its side. */
  private drawFez(x: CanvasRenderingContext2D, R: number, flat: number, hs: number) {
    const wb = R * 0.33, wt = R * 0.27;
    const eb = wb * flat, et = wt * flat;
    const H = R * 0.56 * hs;
    // The tassel hangs on the fez's right side; it swings behind it when the head turns right.
    const side = wt * 1.12 * Math.cos(this.yaw);
    const behind = Math.sin(this.yaw) > 0.2;
    const tassel = () => {
      x.strokeStyle = "#141414";
      x.lineWidth = Math.max(0.8, R * 0.06);
      x.beginPath();
      x.moveTo(0, -H - et * 0.3);
      x.quadraticCurveTo(side, -H - et, side, -H * 0.45);
      x.stroke();
      x.fillStyle = "#141414";
      x.beginPath();
      x.ellipse(side, -H * 0.3, Math.max(R * 0.07, 0.7), Math.max(R * 0.14, 1.2), 0, 0, Math.PI * 2);
      x.fill();
    };
    if (behind) tassel();
    x.beginPath();
    x.moveTo(-wt, -H);
    x.lineTo(-wb, 0);
    x.ellipse(0, 0, wb, eb, 0, Math.PI, 0, true);
    x.lineTo(wt, -H);
    x.ellipse(0, -H, wt, et, 0, 0, Math.PI, true);
    x.closePath();
    const g = x.createLinearGradient(wb, 0, -wb, 0);
    g.addColorStop(0, "#E8433A");
    g.addColorStop(1, "#A3161A");
    x.fillStyle = g;
    x.fill();
    x.fillStyle = "#B81D22"; // top of the fez
    x.beginPath();
    x.ellipse(0, -H, wt, et, 0, 0, Math.PI * 2);
    x.fill();
    if (!behind) tassel();
  }

  /** Scratch paw: a little round paw swiping across the face. */
  private drawPaw(x: CanvasRenderingContext2D, R: number) {
    const p = this.paw;
    const px = lerp(R * 1.25, R * 0.15, p);
    const py = lerp(-R * 0.35, R * 0.55, p);
    const pr = R * 0.3;
    x.save();
    x.translate(px, py);
    x.rotate(-0.6);
    x.globalAlpha = clamp(p * 3, 0, 1);
    x.beginPath();
    x.ellipse(0, 0, pr, pr * 0.85, 0, 0, Math.PI * 2);
    const g = x.createLinearGradient(pr, -pr, -pr, pr);
    g.addColorStop(0, this.pal.top);
    g.addColorStop(1, this.pal.bottom);
    x.fillStyle = g;
    x.fill();
    x.strokeStyle = this.pal.rim ?? "rgba(0,0,0,0.12)";
    x.lineWidth = Math.max(0.6, R * 0.03);
    x.stroke();
    x.fillStyle = this.pal.earInner;
    x.beginPath(); x.ellipse(0, pr * 0.2, pr * 0.36, pr * 0.28, 0, 0, Math.PI * 2); x.fill();
    for (const b of [-1, 0, 1]) {
      x.beginPath(); x.arc(b * pr * 0.4, -pr * 0.38 + Math.abs(b) * pr * 0.1, pr * 0.14, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  }

  private drawBadge(x: CanvasRenderingContext2D, badge: Badge, R: number, cx: number, cy: number) {
    const bs = this.badgeS;
    const bx = cx + R * 1.05 * this.sx;
    const by = cy - R * 0.2 * this.sy;
    const t = now();
    x.save();
    x.translate(bx, by);
    x.scale(bs, bs);
    const col = rgba(badge.color);
    if (badge.kind === "dots") {
      const pw = R * 0.72, ph = R * 0.36;
      roundRectPath(x, -pw / 2, -ph / 2, pw, ph, ph / 2);
      x.fillStyle = col;
      x.fill();
      for (let i = 0; i < 3; i++) {
        const phase = (((t * 2.4 - i * 0.22) % 1) + 1) % 1;
        const dotR = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(phase * Math.PI * 2)));
        x.fillStyle = "#fff";
        x.beginPath();
        x.arc((i - 1) * R * 0.18, 0, dotR, 0, Math.PI * 2);
        x.fill();
      }
    } else if (badge.kind === "bang") {
      x.fillStyle = "#000";
      x.beginPath(); x.arc(0, 0, R * 0.3, 0, Math.PI * 2); x.fill();
      x.fillStyle = col;
      x.beginPath(); x.arc(0, 0, R * 0.23, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#fff";
      x.font = `900 ${R * 0.32}px ${FONT}`;
      x.textAlign = "center";
      x.textBaseline = "middle";
      x.fillText("!", 0, R * 0.02);
    } else {
      x.fillStyle = "#000";
      x.beginPath(); x.arc(0, 0, R * 0.2, 0, Math.PI * 2); x.fill();
      x.fillStyle = col;
      x.beginPath(); x.arc(0, 0, R * 0.135, 0, Math.PI * 2); x.fill();
    }
    x.restore();
  }

  private drawParticles(x: CanvasRenderingContext2D, R: number, cx: number, cy: number) {
    for (const p of this.particles) {
      if (p.age <= 0) continue;
      const k = p.age / p.life;
      const a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
      const px = cx + (p.x + p.vx * p.age) * R * 1.3;
      const py = cy + (p.y + p.vy * p.age * (this.small ? 0.5 : 1)) * R * 1.3;
      const sz = R * p.size * (1 + k * 0.4);
      x.save();
      x.translate(px, py);
      // Fade out near the canvas top instead of being cut by its edge.
      x.globalAlpha = clamp(a, 0, 1) * clamp(py / (R * 0.6), 0, 1);
      switch (p.type) {
        case "heart":
          x.rotate(Math.sin(p.age * 6) * 0.3);
          x.fillStyle = "#FF4D6D";
          heartPath(x, sz);
          x.fill();
          break;
        case "star":
          x.rotate(p.rot + p.age * 2);
          x.fillStyle = "#F7B32B";
          starPath(x, sz, sz * 0.45);
          x.fill();
          break;
        case "spark":
          x.rotate(p.rot);
          x.fillStyle = "#fff";
          starPath(x, sz * 0.8, sz * 0.18);
          x.fill();
          break;
        case "sweat":
          x.fillStyle = "#7CC7FF";
          x.beginPath();
          x.moveTo(0, -sz);
          x.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6);
          x.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz);
          x.fill();
          break;
        case "z":
          x.fillStyle = "rgb(209,219,235)";
          x.font = `700 ${sz * 1.9}px ${FONT}`;
          x.textAlign = "center";
          x.textBaseline = "middle";
          x.fillText("z", 0, 0);
          break;
        case "claw": {
          // Three scratch marks, drawn in quickly then fading.
          const len = sz * Math.min(1, k * 4);
          x.rotate(p.rot);
          x.strokeStyle = "rgba(255,255,255,0.9)";
          x.lineWidth = Math.max(0.8, R * 0.05);
          x.lineCap = "round";
          for (const o of [-1, 0, 1]) {
            x.beginPath();
            x.moveTo(o * sz * 0.28, -len / 2);
            x.lineTo(o * sz * 0.28 + len * 0.1, len / 2);
            x.stroke();
          }
          break;
        }
      }
      x.restore();
    }
  }
}
