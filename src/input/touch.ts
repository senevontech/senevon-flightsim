/* On-screen controls for phones and tablets:
   - left: a floating stick (drag anywhere in the left zone), or TILT steering when enabled;
   - right: a vertical throttle slider with FLAP ▲ / FLAP ▼ / BRAKE beside it, and a row of
     small round buttons above (camera, autopilot, rewind, gear). Landscape only.
   Writes into InputManager.touch / throttle / flaps, so assists and physics are unchanged. */
import type { InputManager } from "./controls";

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Thumb offset (−1…1 of the stick radius) → stick input: a small dead zone, then straight.
    The assists already shape the response (sim/assists.ts); a second curve here made the middle
    of the stick feel dead (half deflection banked only 9° in Easy) and the edge abrupt. */
export function stickAxis(v: number): number {
  const a = Math.abs(v);
  if (a < 0.06) return 0;
  return Math.sign(v) * Math.min(1, (a - 0.06) / 0.94);
}

export class TouchControls {
  readonly el = document.createElement("div");
  private stickBase!: HTMLElement;
  private knob!: HTMLElement;
  private thrFill!: HTMLElement;
  private thrLabel!: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private tiltOn = false;
  private tiltZero = { beta: 0, gamma: 0 };
  private lastOrientation: { beta: number; gamma: number } | null = null;
  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    this.lastOrientation = { beta: e.beta, gamma: e.gamma };
  };

  constructor(private input: InputManager) {
    this.el.className = "touch-ui"; // not "touch": that class marks <body> in touch mode
    this.el.innerHTML = `
      <div class="tc-stick-zone" data-t="zone">
        <div class="tc-stick" data-t="base"><div class="tc-knob" data-t="knob"></div></div>
        <div class="tc-tilt-label hidden" data-t="tilt">TILT</div>
      </div>
      <div class="tc-right">
        <div class="tc-icons">
          <button data-a="camera" aria-label="Camera">CAM</button>
          <button data-a="autopilot" aria-label="Autopilot">AP</button>
          <button data-a="rewind" aria-label="Rewind 10 seconds">⟲</button>
          <button data-a="gear" aria-label="Landing gear">GEAR</button>
        </div>
        <div class="tc-pad">
          <div class="tc-buttons">
            <button data-a="flapsUp" aria-label="Flaps up">FLAP ▲</button>
            <button data-a="flapsDown" aria-label="Flaps down">FLAP ▼</button>
            <button data-a="brake" aria-label="Brakes (hold)">BRAKE</button>
          </div>
          <div class="tc-throttle" data-t="thr" aria-label="Throttle">
            <div class="tc-thr-fill" data-t="fill"></div>
            <div class="tc-thr-ticks"></div>
            <div class="tc-thr-mark top">FULL</div>
            <div class="tc-thr-mark bottom">IDLE</div>
            <div class="tc-thr-label" data-t="thrLabel">0%</div>
          </div>
        </div>
      </div>`;
    const q = (s: string) => this.el.querySelector(`[data-t=${s}]`) as HTMLElement;
    this.stickBase = q("base");
    this.knob = q("knob");
    this.thrFill = q("fill");
    this.thrLabel = q("thrLabel");

    // ---- stick: appears where the thumb lands in the left zone ----
    const zone = q("zone");
    zone.addEventListener("pointerdown", (e) => {
      if (this.tiltOn || this.stickId !== null) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const zr = zone.getBoundingClientRect();
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX - zr.left}px`;
      this.stickBase.style.top = `${e.clientY - zr.top}px`;
      this.stickBase.classList.add("active");
      this.input.touch.active = true;
      this.moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stickBase.classList.remove("active");
      this.stickBase.style.left = this.stickBase.style.top = ""; // back to its rest spot
      this.knob.style.transform = "translate(-50%, -50%)";
      this.input.touch.pitch = this.input.touch.roll = 0;
      this.input.touch.active = false;
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);

    // ---- throttle: absolute position on the track ----
    const thr = q("thr");
    let lastEnd = -1;
    const setThr = (e: PointerEvent) => {
      const r = thr.getBoundingClientRect();
      let v = 1 - (e.clientY - r.top) / r.height;
      if (v < 0.04) v = 0;
      if (v > 0.96) v = 1;
      const end = v === 0 ? 0 : v === 1 ? 1 : -1;
      if (end !== -1 && end !== lastEnd) navigator.vibrate?.(12);
      lastEnd = end;
      this.input.setThrottle(v);
    };
    thr.addEventListener("pointerdown", (e) => {
      thr.setPointerCapture(e.pointerId);
      setThr(e);
    });
    thr.addEventListener("pointermove", (e) => {
      if (thr.hasPointerCapture(e.pointerId)) setThr(e);
    });

    // ---- buttons ----
    for (const b of this.el.querySelectorAll<HTMLButtonElement>("button[data-a]")) {
      const a = b.dataset.a!;
      if (a === "brake") {
        b.addEventListener("pointerdown", () => {
          this.input.touch.brake = true;
          b.classList.add("held");
        });
        for (const ev of ["pointerup", "pointercancel", "pointerleave"]) {
          b.addEventListener(ev, () => {
            this.input.touch.brake = false;
            b.classList.remove("held");
          });
        }
        continue;
      }
      b.addEventListener("click", () => {
        if (a === "flapsUp") this.input.stepFlaps(-1);
        else if (a === "flapsDown") this.input.stepFlaps(1);
        else if (a === "gear") {
          this.input.setGear(this.input.raw.gear <= 0.5);
          this.input.trigger("gear");
        } else this.input.trigger(a as "camera" | "autopilot" | "rewind");
        navigator.vibrate?.(8);
      });
    }
  }

  private moveStick(x: number, y: number): void {
    const R = this.stickBase.getBoundingClientRect().width / 2 || 60;
    let dx = (x - this.stickOrigin.x) / R, dy = (y - this.stickOrigin.y) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.knob.style.transform = `translate(calc(-50% + ${dx * R}px), calc(-50% + ${dy * R}px))`;
    this.input.touch.roll = stickAxis(dx);
    // stick convention: pull back (drag down) = nose up
    this.input.touch.pitch = stickAxis(dy);
  }

  /** Show the GEAR button only on aircraft with retractable gear. */
  setGearAvailable(on: boolean): void {
    this.el.querySelector("[data-a=gear]")?.classList.toggle("hidden", !on);
  }

  get tilt(): boolean {
    return this.tiltOn;
  }

  /** Enable/disable tilt steering. Returns false if the device/permission doesn't allow it. */
  async setTilt(on: boolean): Promise<boolean> {
    if (on) {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      try {
        if (typeof DOE.requestPermission === "function" && (await DOE.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
      window.addEventListener("deviceorientation", this.onOrientation);
      this.tiltOn = true;
      this.input.touch.active = true;
      setTimeout(() => this.calibrate(), 300);
    } else {
      window.removeEventListener("deviceorientation", this.onOrientation);
      this.tiltOn = false;
      this.input.touch.active = false;
      this.input.touch.pitch = this.input.touch.roll = 0;
    }
    (this.el.querySelector("[data-t=tilt]") as HTMLElement).classList.toggle("hidden", !this.tiltOn);
    this.stickBase.classList.toggle("hidden", this.tiltOn);
    return true;
  }

  /** Current phone attitude becomes "neutral". */
  calibrate(): void {
    if (this.lastOrientation) this.tiltZero = { ...this.lastOrientation };
  }

  /** Call every frame: tilt → stick, throttle display. */
  update(): void {
    if (this.tiltOn && this.lastOrientation) {
      const angle = (screen.orientation?.angle ?? 0) % 360;
      const db = this.lastOrientation.beta - this.tiltZero.beta;
      const dg = this.lastOrientation.gamma - this.tiltZero.gamma;
      let roll: number, pitch: number;
      if (angle === 90) { roll = db; pitch = dg; }
      else if (angle === 270) { roll = -db; pitch = -dg; }
      else { roll = dg; pitch = -db; }
      // ~30° of tilt = full roll, ~25° = full pitch; tilting the top edge toward you = nose up
      this.input.touch.roll = clamp(roll / 30);
      this.input.touch.pitch = clamp(pitch / 25);
      this.input.touch.active = true;
    }
    const t = Math.round(this.input.raw.throttle * 100);
    this.thrFill.style.height = `${t}%`;
    this.thrLabel.textContent = `${t}%`;
  }
}
