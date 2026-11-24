/* Minimal autopilot: holds altitude / vertical speed / airspeed (via pitch) and heading.
   Used by the flight-test checklist; the basis for the airliner autopilot later. */
import type { AircraftSim } from "./aircraft";
import { KT, type Controls } from "./types";

export interface ApTargets {
  /** Hold this altitude (m). */
  altitude?: number;
  /** Hold this vertical speed (m/s); ignored when `altitude` or `ias` is set. */
  vs?: number;
  /** Hold this indicated airspeed (knots) with pitch. */
  ias?: number;
  /** Hold this heading (deg). Wings level if undefined. */
  heading?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Autopilot {
  targets: ApTargets = {};
  /** Inner loop integrator (acts as elevator trim). */
  private iPitch = 0;
  /** Outer loop integrator (pitch attitude bias, deg). */
  private iOuter = 0;

  reset(): void {
    this.iPitch = 0;
    this.iOuter = 0;
  }

  update(sim: AircraftSim, dt: number, out: Controls): Controls {
    const t = this.targets;
    // outer loop → pitch attitude target (deg)
    let pitchTarget: number;
    if (t.ias !== undefined) {
      const e = (sim.ias - t.ias * KT) / KT; // knots too fast → nose up
      this.iOuter = clamp(this.iOuter + e * 0.25 * dt, -10, 20);
      pitchTarget = this.iOuter + e * 0.6;
    } else {
      const vsTarget = t.altitude !== undefined ? clamp((t.altitude - sim.pos.y) * 0.12, -4, 4) : (t.vs ?? 0);
      const e = vsTarget - sim.vs;
      this.iOuter = clamp(this.iOuter + e * 0.4 * dt, -10, 20);
      pitchTarget = this.iOuter + e * 0.8;
    }
    pitchTarget = clamp(pitchTarget, -15, 20);
    // inner loop: pitch attitude hold with rate damping
    const err = pitchTarget - sim.pitchDeg;
    this.iPitch = clamp(this.iPitch + err * 0.02 * dt, -0.8, 0.8);
    out.pitch = clamp(err * 0.06 + this.iPitch - sim.w.x * 1.2, -1, 1);

    let bankTarget = 0;
    if (t.heading !== undefined) {
      const hErr = ((t.heading - sim.headingDeg + 540) % 360) - 180;
      bankTarget = clamp(hErr * 1.5, -25, 25);
    }
    out.roll = clamp((bankTarget - sim.bankDeg) * 0.03 + sim.w.z * 0.4, -1, 1);
    out.yaw = sim.onGround ? 0 : clamp(sim.beta * 4, -1, 1);
    return out;
  }
}
