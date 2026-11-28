/* Keyboard + mouse + gamepad → one raw Controls object (the pilot's stick).
   - Keyboard axes ramp smoothly (binary keys would otherwise slam the stick).
   - Mouse flying (toggle Y): the cursor's offset from the screen centre is the stick.
   - No Ctrl bindings: in a browser Ctrl+W closes the tab and Ctrl+S opens "save".
   Mobile tilt/touch arrives in P4 and writes into the same object. */
import { emptyControls, type Controls } from "../sim/types";

export type Action =
  | "camera" | "reset" | "approach" | "pause" | "help" | "assists" | "flapsDown" | "flapsUp"
  | "invert" | "mouse" | "nextAirport" | "time" | "autopilot" | "rewind" | "map" | "menu" | "simRate" | "gear";

const AXIS_RATE = 3.2; // full stick in ~0.3 s
const RETURN_RATE = 5; // back to centre in ~0.2 s
const THROTTLE_RATE = 0.55;
const TRIM_RATE = 0.25;
export const MOUSE_RANGE = 0.32; // fraction of the screen's shorter side = full stick
const MOUSE_DEADZONE = 0.06;

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));

function approach(cur: number, target: number, dt: number): number {
  const rate = target === 0 ? RETURN_RATE : AXIS_RATE;
  // reversing direction snaps faster
  const r = target !== 0 && Math.sign(target) !== Math.sign(cur) ? rate * 2 : rate;
  return cur + Math.max(-r * dt, Math.min(r * dt, target - cur));
}

export class InputManager {
  readonly raw: Controls = emptyControls();
  private keys = new Set<string>();
  private flapIndex = 0;
  private padPrev: boolean[] = [];
  private actions: ((a: Action) => void)[] = [];
  /** Last input device, for help text / HUD. */
  device: "keyboard" | "mouse" | "gamepad" | "touch" = "keyboard";
  /** Written by the on-screen touch controls (stick or tilt). Pitch: + = nose up (before invert). */
  readonly touch = { active: false, pitch: 0, roll: 0, brake: false };
  /** Invert pitch for keyboard and gamepad (mouse is always "cursor up = nose up"). */
  invertPitch = false;
  /** Stick sensitivity multiplier for pitch / roll (0.6 low, 0.8 medium, 1 high). */
  sensitivity = 1;
  /** Mouse flying on/off. */
  mouseFlying = false;
  /** Cursor stick position −1..1 (x right, y up), for the HUD. */
  readonly mouseStick = { x: 0, y: 0 };
  private mouseX = 0;
  private mouseY = 0;

  constructor(private flapSteps: number[], target: Window = window) {
    target.addEventListener("keydown", (e) => this.onKey(e, true));
    target.addEventListener("keyup", (e) => this.onKey(e, false));
    target.addEventListener("blur", () => this.keys.clear());
    target.addEventListener("pointermove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
  }

  onAction(cb: (a: Action) => void): void {
    this.actions.push(cb);
  }

  setFlapIndex(i: number): void {
    this.flapIndex = Math.max(0, Math.min(this.flapSteps.length - 1, i));
    this.raw.flaps = this.flapSteps[this.flapIndex];
  }

  /** Switch aircraft: new flap detents (lever goes to the first). */
  setFlapSteps(steps: number[]): void {
    this.flapSteps = steps;
    this.setFlapIndex(0);
  }

  setGear(down: boolean): void {
    this.raw.gear = down ? 1 : 0;
  }

  setThrottle(t: number): void {
    this.raw.throttle = clamp(t, 0, 1);
  }

  resetTrim(): void {
    this.raw.trim = 0;
  }

  /** Move the flap lever one detent (+1 = down). */
  stepFlaps(d: number): void {
    this.setFlapIndex(this.flapIndex + d);
    this.emit(d > 0 ? "flapsDown" : "flapsUp");
  }

  /** Trigger an action from UI buttons (touch, menu). */
  trigger(a: Action): void {
    this.emit(a);
  }

  private emit(a: Action): void {
    for (const cb of this.actions) cb(a);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.code;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    // typing in a text box (the airport search) is not flying
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range" || t.tagName === "TEXTAREA")) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab", "PageUp", "PageDown"].includes(k)) e.preventDefault();
    if (down) {
      if (!this.keys.has(k) && !e.repeat) {
        switch (k) {
          case "KeyC": this.emit("camera"); break;
          case "KeyR": this.emit("reset"); break;
          case "KeyL": this.emit("approach"); break;
          case "KeyP": case "Escape": this.emit("menu"); break;
          case "KeyH": this.emit("help"); break;
          case "KeyM": this.emit("assists"); break;
          case "KeyI": this.invertPitch = !this.invertPitch; this.emit("invert"); break;
          case "KeyY": this.mouseFlying = !this.mouseFlying; this.emit("mouse"); break;
          case "KeyN": this.emit("nextAirport"); break;
          case "KeyT": this.emit("time"); break;
          case "KeyJ": this.emit("autopilot"); break;
          case "KeyX": this.emit("simRate"); break;
          case "KeyG": this.raw.gear = this.raw.gear > 0.5 ? 0 : 1; this.emit("gear"); break;
          case "Backspace": this.emit("rewind"); break;
          case "Tab": this.emit("map"); break;
          case "KeyF": this.setFlapIndex(this.flapIndex + 1); this.emit("flapsDown"); break;
          case "KeyV": this.setFlapIndex(this.flapIndex - 1); this.emit("flapsUp"); break;
          case "Digit1": this.raw.throttle = 0; break;
          case "Digit0": this.raw.throttle = 1; break;
        }
      }
      this.keys.add(k);
    } else this.keys.delete(k);
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt: number): Controls {
    const r = this.raw;
    // keyboard: S / ↓ = pull (nose up), W / ↑ = push (nose down) — flight-sim convention.
    let pitchT = (this.key("KeyS", "ArrowDown") ? 1 : 0) - (this.key("KeyW", "ArrowUp") ? 1 : 0);
    if (this.invertPitch) pitchT = -pitchT;
    const rollT = (this.key("KeyD", "ArrowRight") ? 1 : 0) - (this.key("KeyA", "ArrowLeft") ? 1 : 0);
    const yawT = (this.key("KeyE", "Period") ? 1 : 0) - (this.key("KeyQ", "Comma") ? 1 : 0);
    const keyboardActive = pitchT !== 0 || rollT !== 0;
    if (keyboardActive) this.device = "keyboard";

    if (this.touch.active && !keyboardActive) {
      r.pitch = this.invertPitch ? -this.touch.pitch : this.touch.pitch;
      r.roll = this.touch.roll;
      this.device = "touch";
    } else if (this.mouseFlying && !keyboardActive) {
      // cursor offset from the centre of the screen is the stick
      const s = Math.min(window.innerWidth, window.innerHeight) * MOUSE_RANGE;
      const dz = (v: number) => (Math.abs(v) < MOUSE_DEADZONE ? 0 : (v - Math.sign(v) * MOUSE_DEADZONE) / (1 - MOUSE_DEADZONE));
      this.mouseStick.x = clamp((this.mouseX - window.innerWidth / 2) / s);
      this.mouseStick.y = clamp(-(this.mouseY - window.innerHeight / 2) / s);
      r.roll = dz(this.mouseStick.x);
      r.pitch = dz(this.mouseStick.y);
      this.device = "mouse";
    } else {
      r.pitch = approach(r.pitch, pitchT, dt);
      r.roll = approach(r.roll, rollT, dt);
    }
    r.yaw = approach(r.yaw, yawT, dt);

    if (this.key("ShiftLeft", "ShiftRight", "Equal", "NumpadAdd", "PageUp")) r.throttle = clamp(r.throttle + THROTTLE_RATE * dt, 0, 1);
    if (this.key("KeyZ", "Minus", "NumpadSubtract", "PageDown")) r.throttle = clamp(r.throttle - THROTTLE_RATE * dt, 0, 1);
    if (this.key("BracketRight", "Home")) r.trim = clamp(r.trim + TRIM_RATE * dt);
    if (this.key("BracketLeft", "End")) r.trim = clamp(r.trim - TRIM_RATE * dt);
    r.brakes = this.key("KeyB", "Space") || this.touch.brake ? 1 : 0;
    this.pollGamepad(dt);
    return r;
  }

  private pollGamepad(dt: number): void {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.1 ? 0 : (v - Math.sign(v) * 0.1) / 0.9);
    const ax = pad.axes;
    const b = (i: number) => pad.buttons[i]?.value ?? 0;
    const pressed = (i: number) => !!pad.buttons[i]?.pressed;
    const roll = dz(ax[0] ?? 0);
    let pitch = dz(ax[1] ?? 0); // stick back (+) = nose up
    if (this.invertPitch) pitch = -pitch;
    const yaw = b(7) - b(6); // triggers
    if (Math.abs(roll) + Math.abs(pitch) + Math.abs(yaw) > 0.02) this.device = "gamepad";
    if (this.device === "gamepad") {
      this.raw.roll = roll;
      this.raw.pitch = pitch;
      this.raw.yaw = yaw;
    }
    // right stick Y also drives throttle (push up = more)
    const thr = dz(ax[3] ?? 0);
    if (thr) this.raw.throttle = clamp(this.raw.throttle - thr * THROTTLE_RATE * dt, 0, 1);
    if (pressed(5)) this.raw.throttle = clamp(this.raw.throttle + THROTTLE_RATE * dt, 0, 1);
    if (pressed(4)) this.raw.throttle = clamp(this.raw.throttle - THROTTLE_RATE * dt, 0, 1);
    if (pressed(0)) this.raw.brakes = 1;
    const edge = (i: number) => pressed(i) && !this.padPrev[i];
    if (edge(12)) { this.setFlapIndex(this.flapIndex - 1); this.emit("flapsUp"); }
    if (edge(13)) { this.setFlapIndex(this.flapIndex + 1); this.emit("flapsDown"); }
    if (edge(3)) this.emit("camera");
    if (edge(9)) this.emit("menu");
    if (edge(8)) this.emit("reset");
    if (edge(2)) this.emit("approach");
    if (edge(1)) this.emit("assists");
    this.padPrev = pad.buttons.map((x) => x.pressed);
  }
}
