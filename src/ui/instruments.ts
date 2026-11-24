/* Flight instruments drawn on canvas: airspeed, attitude, altimeter, vertical speed and a
   heading tape. Minimal modern look: dark translucent faces, fine white ticks, Skyward-orange
   accents. Each gauge redraws only when its value changes noticeably. */

const ACCENT = "#ff7a1a";
/** "light" = white marks for dark backgrounds; "dark" = dark marks for bright sky / runway. */
export type Tone = "light" | "dark";
const PALETTES: Record<Tone, { tick: string; dim: string; fg: string; pill: string; ring: string; shadow: string }> = {
  light: { tick: "rgba(255,255,255,0.92)", dim: "rgba(255,255,255,0.6)", fg: "#ffffff", pill: "rgba(0,0,0,0.42)", ring: "rgba(255,255,255,0.22)", shadow: "rgba(0,0,0,0.7)" },
  dark: { tick: "rgba(14,18,24,0.92)", dim: "rgba(14,18,24,0.62)", fg: "#0e1218", pill: "rgba(255,255,255,0.55)", ring: "rgba(14,18,24,0.25)", shadow: "rgba(255,255,255,0.75)" },
};
// current palette: set by each gauge right before it draws (drawing is synchronous)
let TICK = PALETTES.light.tick;
let DIM = PALETTES.light.dim;
let FG = PALETTES.light.fg;
let PILL = PALETTES.light.pill;
let RING = PALETTES.light.ring;
// faces are see-through: the frosted-glass tile behind the canvas does the work
// no painted face: the round 2 % frosted disc behind the canvas (CSS) is the only background
const FACE_IN = "rgba(0,0,0,0)";
const FACE_OUT = "rgba(0,0,0,0)";
const FONT = "600 {s}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const font = (px: number) => FONT.replace("{s}", String(Math.round(px)));

abstract class Gauge {
  readonly canvas = document.createElement("canvas");
  protected g: CanvasRenderingContext2D;
  protected size = 0;
  private lastKey = "";
  private tone: Tone = "light";

  /** Switch mark colours for the brightness behind the gauge (forces a redraw). */
  setTone(t: Tone): void {
    if (t === this.tone) return;
    this.tone = t;
    this.lastKey = "";
  }

  constructor(className: string) {
    this.canvas.className = `gauge ${className}`;
    this.g = this.canvas.getContext("2d")!;
  }

  /** Match the canvas backing store to its CSS size × device pixel ratio. */
  protected fit(): boolean {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (!w || !h) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.lastKey = "";
    }
    this.size = Math.min(w, h);
    return true;
  }

  /** Redraw if `key` (rounded values) changed. */
  protected maybeDraw(key: string, draw: () => void): void {
    if (!this.fit() || key === this.lastKey) return;
    this.lastKey = key;
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const p = PALETTES[this.tone];
    TICK = p.tick; DIM = p.dim; FG = p.fg; PILL = p.pill; RING = p.ring;
    // a halo in the opposite tone under every mark keeps it readable on any background
    this.g.shadowColor = p.shadow;
    this.g.shadowBlur = this.size * 0.03;
    draw();
  }

  protected face(): { cx: number; cy: number; R: number } {
    const g = this.g, s = this.size;
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2, R = s / 2 - s * 0.02;
    const grad = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    grad.addColorStop(0, FACE_IN);
    grad.addColorStop(1, FACE_OUT);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = RING;
    g.lineWidth = s * 0.012;
    g.stroke();
    return { cx, cy, R };
  }

  protected ticks(cx: number, cy: number, R: number, from: number, to: number, a0: number, a1: number, step: number, major: number, label?: (v: number) => string): void {
    const g = this.g, s = this.size;
    for (let v = from; v <= to + 1e-6; v += step) {
      const a = a0 + ((v - from) / (to - from)) * (a1 - a0);
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const len = isMajor ? R * 0.13 : R * 0.07;
      g.strokeStyle = isMajor ? TICK : DIM;
      g.lineWidth = isMajor ? s * 0.012 : s * 0.007;
      g.beginPath();
      g.moveTo(cx + Math.sin(a) * (R * 0.92), cy - Math.cos(a) * (R * 0.92));
      g.lineTo(cx + Math.sin(a) * (R * 0.92 - len), cy - Math.cos(a) * (R * 0.92 - len));
      g.stroke();
      const text = isMajor && label ? label(v) : "";
      if (text) {
        g.fillStyle = TICK;
        g.font = font(s * 0.08);
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(text, cx + Math.sin(a) * R * 0.68, cy - Math.cos(a) * R * 0.68);
      }
    }
  }

  protected needle(cx: number, cy: number, a: number, len: number, width: number, color = ACCENT): void {
    const g = this.g;
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-width / 2, len * 0.15);
    g.lineTo(-width * 0.25, -len);
    g.lineTo(width * 0.25, -len);
    g.lineTo(width / 2, len * 0.15);
    g.closePath();
    g.fill();
    g.restore();
    g.fillStyle = "#1a1e25";
    g.beginPath();
    g.arc(cx, cy, width * 0.9, 0, Math.PI * 2);
    g.fill();
  }

  protected readout(cx: number, y: number, text: string, unit: string): void {
    const g = this.g, s = this.size;
    g.font = font(s * 0.11);
    const w = Math.max(g.measureText(text).width + s * 0.07, s * 0.28);
    g.fillStyle = PILL;
    g.fillRect(cx - w / 2, y - s * 0.07, w, s * 0.14);
    g.fillStyle = FG;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, cx, y + s * 0.005);
    g.fillStyle = DIM;
    g.font = font(s * 0.065);
    g.fillText(unit, cx, y + s * 0.12);
  }

  protected arcBand(cx: number, cy: number, R: number, a0: number, a1: number, color: string, w: number): void {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    g.arc(cx, cy, R, a0 - Math.PI / 2, a1 - Math.PI / 2);
    g.stroke();
  }
}

/** Airspeed indicator with white (flap), green (normal), yellow (caution) arcs and Vne line. */
export class AirspeedGauge extends Gauge {
  constructor(private v: { vs0: number; vs1: number; vfe: number; vno: number; vne: number }, private max = 200) {
    super("asi");
  }
  private ang(kt: number): number {
    const a0 = -150 * Math.PI / 180, a1 = 150 * Math.PI / 180;
    return a0 + (Math.min(Math.max(kt, 0), this.max) / this.max) * (a1 - a0);
  }
  draw(kt: number): void {
    this.maybeDraw(String(Math.round(kt)), () => {
      const { cx, cy, R } = this.face();
      const s = this.size, v = this.v;
      this.arcBand(cx, cy, R * 0.95, this.ang(v.vs0), this.ang(v.vfe), "rgba(255,255,255,0.85)", s * 0.02);
      this.arcBand(cx, cy, R * 0.9, this.ang(v.vs1), this.ang(v.vno), "#34c759", s * 0.03);
      this.arcBand(cx, cy, R * 0.9, this.ang(v.vno), this.ang(v.vne), "#ffcc00", s * 0.03);
      this.arcBand(cx, cy, R * 0.9, this.ang(v.vne) - 0.012, this.ang(v.vne) + 0.012, "#ff3b30", s * 0.06);
      this.ticks(cx, cy, R, 0, this.max, this.ang(0), this.ang(this.max), 10, 40, (x) => (x === 0 || x === this.max ? "" : String(x)));
      this.readout(cx, cy + R * 0.3, String(Math.round(kt)), "KT");
      this.needle(cx, cy, this.ang(kt), R * 0.82, s * 0.035);
    });
  }
}

/** Artificial horizon: sky/ground, pitch ladder, bank scale, fixed aircraft symbol. */
export class AttitudeGauge extends Gauge {
  constructor() {
    super("adi");
  }
  draw(pitchDeg: number, bankDeg: number): void {
    this.maybeDraw(`${pitchDeg.toFixed(1)}:${bankDeg.toFixed(1)}`, () => {
      const g = this.g, s = this.size;
      const cx = this.canvas.width / 2, cy = this.canvas.height / 2, R = s / 2 - s * 0.02;
      const ppd = R / 28; // pixels per degree of pitch
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.clip();
      g.translate(cx, cy);
      g.rotate((-bankDeg * Math.PI) / 180);
      g.translate(0, pitchDeg * ppd);
      const sky = g.createLinearGradient(0, -R * 2, 0, 0);
      sky.addColorStop(0, "#1f5fa8");
      sky.addColorStop(1, "#5aa0dc");
      g.fillStyle = sky;
      g.fillRect(-R * 2, -R * 4, R * 4, R * 4);
      const ground = g.createLinearGradient(0, 0, 0, R * 2);
      ground.addColorStop(0, "#8a6a45");
      ground.addColorStop(1, "#4e3a26");
      g.fillStyle = ground;
      g.fillRect(-R * 2, 0, R * 4, R * 4);
      g.strokeStyle = "#fff";
      g.lineWidth = s * 0.012;
      g.beginPath();
      g.moveTo(-R * 2, 0);
      g.lineTo(R * 2, 0);
      g.stroke();
      // pitch ladder
      g.font = font(s * 0.06);
      g.fillStyle = "#fff";
      g.textBaseline = "middle";
      for (let p = -30; p <= 30; p += 5) {
        if (!p) continue;
        const y = -p * ppd;
        const w = p % 10 === 0 ? R * 0.32 : R * 0.16;
        g.lineWidth = s * 0.008;
        g.beginPath();
        g.moveTo(-w / 2, y);
        g.lineTo(w / 2, y);
        g.stroke();
        if (p % 10 === 0) {
          g.textAlign = "left";
          g.fillText(String(Math.abs(p)), w / 2 + s * 0.02, y);
        }
      }
      g.restore();
      // bank scale (fixed) and pointer (rotates with the horizon)
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = TICK;
      for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const a = (b * Math.PI) / 180;
        const len = b % 30 === 0 ? R * 0.12 : R * 0.07;
        g.lineWidth = s * 0.01;
        g.beginPath();
        g.moveTo(Math.sin(a) * R * 0.95, -Math.cos(a) * R * 0.95);
        g.lineTo(Math.sin(a) * (R * 0.95 - len), -Math.cos(a) * (R * 0.95 - len));
        g.stroke();
      }
      g.rotate((-bankDeg * Math.PI) / 180);
      g.fillStyle = ACCENT;
      g.beginPath();
      g.moveTo(0, -R * 0.8);
      g.lineTo(-s * 0.035, -R * 0.7);
      g.lineTo(s * 0.035, -R * 0.7);
      g.closePath();
      g.fill();
      g.restore();
      // aircraft symbol
      g.strokeStyle = ACCENT;
      g.lineWidth = s * 0.022;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(cx - R * 0.5, cy);
      g.lineTo(cx - R * 0.18, cy);
      g.lineTo(cx - R * 0.08, cy + R * 0.08);
      g.moveTo(cx + R * 0.5, cy);
      g.lineTo(cx + R * 0.18, cy);
      g.lineTo(cx + R * 0.08, cy + R * 0.08);
      g.stroke();
      g.fillStyle = ACCENT;
      g.beginPath();
      g.arc(cx, cy, s * 0.018, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.16)";
      g.lineWidth = s * 0.012;
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.stroke();
    });
  }
}

/** Altimeter: long needle = hundreds, short needle = thousands, digital readout. */
export class AltimeterGauge extends Gauge {
  constructor() {
    super("alt");
  }
  draw(ft: number): void {
    this.maybeDraw(String(Math.round(ft / 5)), () => {
      const { cx, cy, R } = this.face();
      const s = this.size;
      this.ticks(cx, cy, R, 0, 1000, 0, Math.PI * 2 - 0.0001, 20, 100, (v) => (v === 1000 ? "" : String(v / 100)));
      this.readout(cx, cy + R * 0.3, Math.round(ft).toLocaleString("en-US"), "FT");
      this.needle(cx, cy, ((ft % 10000) / 10000) * Math.PI * 2, R * 0.5, s * 0.06, "rgba(255,255,255,0.9)");
      this.needle(cx, cy, ((ft % 1000) / 1000) * Math.PI * 2, R * 0.84, s * 0.035);
    });
  }
}

/** Vertical speed: ±2000 ft/min, zero at nine o'clock. */
export class VsiGauge extends Gauge {
  constructor() {
    super("vsi");
  }
  private ang(fpm: number): number {
    const v = Math.max(-2000, Math.min(2000, fpm));
    return -Math.PI / 2 + (v / 2000) * (170 * Math.PI / 180);
  }
  draw(fpm: number): void {
    this.maybeDraw(String(Math.round(fpm / 10)), () => {
      const { cx, cy, R } = this.face();
      const s = this.size;
      this.ticks(cx, cy, R, -2000, 2000, this.ang(-2000), this.ang(2000), 100, 500, (v) => (Math.abs(v) === 2000 ? "" : String(Math.abs(v / 100))));
      const g = this.g;
      g.fillStyle = DIM;
      g.font = font(s * 0.06);
      g.textAlign = "left";
      g.fillText("UP", cx - R * 0.55, cy - R * 0.25);
      g.fillText("DN", cx - R * 0.55, cy + R * 0.25);
      this.readout(cx + R * 0.22, cy - R * 0.05, `${fpm > 15 ? "+" : ""}${Math.round(fpm / 10) * 10}`, "FT/MIN");
      this.needle(cx, cy, this.ang(fpm), R * 0.82, s * 0.035);
    });
  }
}

/** Horizontal heading tape with a centre marker and digital heading. */
export class HeadingTape extends Gauge {
  constructor() {
    super("hdg-tape");
  }
  draw(hdg: number, track: number | null): void {
    this.maybeDraw(`${hdg.toFixed(0)}:${track === null ? "" : track.toFixed(0)}`, () => {
      const g = this.g;
      const W = this.canvas.width, H = this.canvas.height;
      const ppd = W / 90; // 90° visible
      g.save();
      g.beginPath();
      g.rect(0, 0, W, H);
      g.clip();
      g.textAlign = "center";
      g.textBaseline = "middle";
      for (let d = Math.floor((hdg - 50) / 5) * 5; d <= hdg + 50; d += 5) {
        const x = W / 2 + (d - hdg) * ppd;
        const n = ((d % 360) + 360) % 360;
        const major = n % 30 === 0;
        g.strokeStyle = major ? TICK : DIM;
        g.lineWidth = H * 0.04;
        g.beginPath();
        g.moveTo(x, H);
        g.lineTo(x, H - (major ? H * 0.32 : n % 10 === 0 ? H * 0.22 : H * 0.12));
        g.stroke();
        if (major) {
          const lbl = n === 0 ? "N" : n === 90 ? "E" : n === 180 ? "S" : n === 270 ? "W" : String(n / 10);
          g.fillStyle = lbl.length === 1 && "NESW".includes(lbl) ? ACCENT : TICK;
          g.font = font(H * 0.34);
          g.fillText(lbl, x, H * 0.36);
        }
      }
      if (track !== null) {
        // ground track diamond (shows wind drift)
        let dt = ((track - hdg + 540) % 360) - 180;
        dt = Math.max(-44, Math.min(44, dt));
        const x = W / 2 + dt * ppd;
        g.fillStyle = "#5ac8fa";
        g.beginPath();
        g.moveTo(x, H * 0.66);
        g.lineTo(x + H * 0.1, H * 0.78);
        g.lineTo(x, H * 0.9);
        g.lineTo(x - H * 0.1, H * 0.78);
        g.fill();
      }
      g.restore();
      // centre readout
      const txt = String(Math.round(hdg) % 360 || 360).padStart(3, "0");
      g.font = font(H * 0.4);
      const bw = H * 1.5;
      g.fillStyle = PILL;
      g.strokeStyle = ACCENT;
      g.lineWidth = H * 0.05;
      g.fillRect(W / 2 - bw / 2, H * 0.04, bw, H * 0.6);
      g.strokeRect(W / 2 - bw / 2, H * 0.04, bw, H * 0.6);
      g.fillStyle = FG;
      g.fillText(txt, W / 2, H * 0.35);
    });
  }
}
