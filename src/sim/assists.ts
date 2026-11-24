/* Control assists = a small "fly-by-wire" layer between the pilot's stick and the control
   surfaces. The physics is the same for every preset (docs/FLIGHT_MODEL.md §7); only how the
   pilot's input becomes surface deflection changes.

   EASY   — attitude command. Roll input banks the plane (up to 50°) and it levels itself when
            you let go. Pitch input sets a pitch RATE; let go and the nose stays where you left
            it. Turns are coordinated, g and stall protected.
   NORMAL — rate command. Roll input sets a roll RATE; let go and the bank angle is held (small
            banks level out). Pitch as Easy with more authority. Coordinated, soft stall guard.
   REAL   — direct. Input moves the surfaces (with a response curve). No help at all. */
import type { AircraftSim } from "./aircraft";
import { DEG, G, type Controls } from "./types";

export type AssistPreset = "easy" | "normal" | "real";

export interface AssistFlags {
  /** Fly-by-wire style rate/attitude command. */
  fbw: boolean;
  /** Bank: "level" = returns to wings level on release, "hold" = keeps the bank. */
  roll: "level" | "hold" | "direct";
  maxPitchRate: number; // deg/s at full input
  maxRollRate: number; // deg/s at full input
  maxBank: number; // deg
  gMax: number;
  gMin: number;
  coordination: boolean;
  stallProtection: "off" | "soft" | "hard";
  approachGuide: boolean;
}

export const PRESETS: Record<AssistPreset, AssistFlags> = {
  easy: { fbw: true, roll: "level", maxPitchRate: 9, maxRollRate: 40, maxBank: 50, gMax: 2.2, gMin: 0, coordination: true, stallProtection: "hard", approachGuide: true },
  normal: { fbw: true, roll: "hold", maxPitchRate: 14, maxRollRate: 55, maxBank: 70, gMax: 3.2, gMin: -0.8, coordination: true, stallProtection: "soft", approachGuide: true },
  real: { fbw: false, roll: "direct", maxPitchRate: 0, maxRollRate: 0, maxBank: 180, gMax: 99, gMin: -99, coordination: false, stallProtection: "off", approachGuide: false },
};

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
/** Response curve: fine control near centre, full authority at the ends. */
const curve = (v: number, e = 1.6) => Math.sign(v) * Math.pow(Math.abs(v), e);

// controller gains (per rad/s of rate error), scaled by dynamic pressure
const KP_PITCH = 2.2;
const KI_PITCH = 3.0;
const KP_ROLL = 1.7;
const KI_ROLL = 0.6;
const V_REF = 50; // m/s (~97 kt) where the gains are tuned

export class Assists {
  preset: AssistPreset = "easy";
  private iPitch = 0;
  private iRoll = 0;
  private pitchHold: number | null = null;
  private bankHold = 0;
  private wasAir = false;

  get flags(): AssistFlags {
    return PRESETS[this.preset];
  }

  reset(): void {
    this.iPitch = 0;
    this.iRoll = 0;
    this.pitchHold = null;
    this.bankHold = 0;
    this.wasAir = false;
  }

  /** Raw pilot input → controls sent to the aircraft. */
  apply(raw: Controls, sim: AircraftSim, dt: number, out: Controls): Controls {
    const f = this.flags;
    Object.assign(out, raw);

    // on the ground the bank input steers too (A/D, arrows, phone stick), like a car
    const groundSteer = (yaw: number) => clamp(yaw + raw.roll * 0.9);

    if (!f.fbw) {
      out.pitch = curve(raw.pitch);
      out.roll = curve(raw.roll);
      out.yaw = sim.onGround ? groundSteer(curve(raw.yaw, 1.3)) : curve(raw.yaw, 1.3);
      this.wasAir = !sim.onGround;
      return out;
    }

    const air = !sim.onGround;
    if (!air) {
      // on the ground: direct elevator for rotation, gentle ailerons, rudder steers
      out.pitch = curve(raw.pitch, 1.3);
      out.roll = raw.roll * 0.5;
      out.yaw = groundSteer(raw.yaw);
      this.iPitch = out.pitch;
      this.iRoll = 0;
      this.pitchHold = null;
      this.bankHold = 0;
      this.wasAir = false;
      return out;
    }
    if (!this.wasAir) {
      // just lifted off (or spawned airborne): start holding what we have
      this.pitchHold = sim.pitchDeg;
      this.bankHold = sim.bankDeg;
      this.wasAir = true;
    }

    const V = Math.max(sim.tas, 15);
    const gain = clamp((V_REF / V) ** 2, 0.35, 3);
    const bank = sim.bankDeg;
    const phi = clamp(bank, -75, 75) * DEG;

    // ---------------- pitch: rate command / attitude hold ----------------
    // body pitch rate needed just to stay level in a coordinated turn
    const qTurn = (G / V) * Math.tan(phi) * Math.sin(phi);
    let qCmd: number; // rad/s
    if (Math.abs(raw.pitch) > 0.03) {
      qCmd = curve(raw.pitch, 1.3) * f.maxPitchRate * DEG + qTurn;
      this.pitchHold = sim.pitchDeg;
    } else {
      if (this.pitchHold === null) this.pitchHold = sim.pitchDeg;
      qCmd = clamp((this.pitchHold - sim.pitchDeg) * 0.8, -4, 4) * DEG + qTurn;
    }
    // g limits
    if (sim.gLoad > f.gMax) qCmd = Math.min(qCmd, sim.w.x - (sim.gLoad - f.gMax) * 0.3);
    if (sim.gLoad < f.gMin) qCmd = Math.max(qCmd, sim.w.x + (f.gMin - sim.gLoad) * 0.3);
    const qErr = qCmd - sim.w.x;
    this.iPitch = clamp(this.iPitch + qErr * KI_PITCH * gain * dt);
    out.pitch = clamp(qErr * KP_PITCH * gain + this.iPitch);

    // stall protection: cap nose-up command near the critical angle of attack
    if (f.stallProtection !== "off") {
      const margin = (f.stallProtection === "hard" ? 3 : 1) * DEG;
      const excess = sim.wingAoa - (this.stallAoa(sim) - margin);
      if (excess > 0) {
        const cap = clamp(this.iPitch - excess / (2 * DEG));
        if (out.pitch > cap) {
          out.pitch = cap;
          this.iPitch = Math.min(this.iPitch, cap + 0.05);
          this.pitchHold = Math.min(this.pitchHold ?? sim.pitchDeg, sim.pitchDeg);
        }
      }
    }

    // ---------------- roll ----------------
    let pCmd: number; // deg/s, + = roll right
    if (f.roll === "level") {
      const input = Math.abs(raw.roll) > 0.03;
      const target = input ? curve(raw.roll, 1.2) * f.maxBank : 0;
      pCmd = clamp((target - bank) * 2.3, -f.maxRollRate, f.maxRollRate);
      // the aileron held during the bank is no longer needed once levelling: bleed it off
      if (!input) this.iRoll *= Math.max(0, 1 - dt * 3);
    } else {
      if (Math.abs(raw.roll) > 0.03) {
        pCmd = curve(raw.roll, 1.3) * f.maxRollRate;
        this.bankHold = bank;
      } else {
        // shallow banks drift back to level; steeper ones are held
        if (Math.abs(this.bankHold) < 6) this.bankHold *= Math.max(0, 1 - dt * 0.8);
        pCmd = clamp((this.bankHold - bank) * 2, -30, 30);
      }
    }
    if (bank > f.maxBank && pCmd > 0) pCmd = (f.maxBank - bank) * 2;
    if (bank < -f.maxBank && pCmd < 0) pCmd = (-f.maxBank - bank) * 2;
    const pErr = pCmd * DEG - -sim.w.z; // roll rate right = −w.z
    this.iRoll = clamp(this.iRoll + pErr * KI_ROLL * gain * dt, -0.3, 0.3);
    out.roll = clamp(pErr * KP_ROLL * gain + this.iRoll);

    // ---------------- yaw: turn coordination ----------------
    if (f.coordination) {
      // expected body yaw rate in a coordinated turn (w.y + = nose left)
      const rTurn = -(G / V) * Math.sin(phi);
      out.yaw = clamp(raw.yaw + sim.beta * 3 + (sim.w.y - rTurn) * 0.4);
    }
    return out;
  }

  /** Wing stall AoA (rad, same reference as sim.wingAoa, i.e. incl. incidence) for the current flaps. */
  private stallAoa(sim: AircraftSim): number {
    const wing = sim.surfaces.find((s) => s.isWing);
    if (!wing) return 15 * DEG;
    const cfg = sim.cfg;
    const cl0 = wing.cfg.cl0 + cfg.flaps.cl0Gain * sim.flaps;
    const clMax = wing.cfg.clMax + cfg.flaps.clMaxGain * sim.flaps;
    return (clMax - cl0) / wing.slope;
  }

  /** Stall warning level 0..1 for the HUD/horn (starts ~4° before the stall). */
  stallWarning(sim: AircraftSim): number {
    if (sim.onGround || sim.ias < 5) return 0;
    const d = this.stallAoa(sim) - sim.wingAoa;
    return clamp(1 - d / (4 * DEG), 0, 1);
  }
}
