/* Autopilot in the style of a modern light-aircraft system.
   Lateral:  HDG (heading select) · NAV (fly to a point) · APR (runway centreline, "localizer")
   Vertical: ALT (climb/descend at the selected VS to the selected altitude, then hold)
             VS (hold a vertical speed) · GS (3° glide path to the runway, in APR) · IAS (pitch for speed)
   Speed:    optional autothrottle holding a selected IAS.
   Inner loops: pitch-attitude hold with rate damping, bank-angle hold; turn coordination via rudder.
   Deterministic (pure function of sim state + targets) so replays stay exact. */
import type { AircraftSim } from "./aircraft";
import { DEG, KT, type Controls } from "./types";
import { runwayCoords, type Runway } from "../world/WorldProvider";

export type LateralMode = "hdg" | "nav" | "apr";
export type VerticalMode = "alt" | "vs" | "gs" | "ias";

export interface ApTargets {
  /** Selected altitude (m). In ALT mode the AP climbs/descends to it at `vsRate`. */
  altitude?: number;
  /** Vertical speed (m/s): VS mode target, or the climb/descent rate used to reach ALT. */
  vs?: number;
  /** Indicated airspeed (knots): IAS mode (pitch) or autothrottle target. */
  ias?: number;
  /** Selected heading (deg). */
  heading?: number;
  lateral?: LateralMode;
  vertical?: VerticalMode;
  /** NAV destination (world x, z). */
  nav?: { x: number; z: number };
  /** Runway for APR / GS. */
  runway?: Runway;
  /** Autothrottle holds `ias` with the throttle. */
  autothrottle?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const wrap180 = (a: number) => ((a + 540) % 360) - 180;
const GS_ANGLE = 3 * DEG;

export class Autopilot {
  targets: ApTargets = {};
  /** Live status for the panel. */
  status = { lateral: "WINGS LVL", vertical: "PITCH", gsCaptured: false, locCaptured: false };
  private iPitch = 0;
  private iOuter = 0;
  private iThrottle = 0;
  private iCross = 0;

  reset(): void {
    this.iPitch = 0;
    this.iOuter = 0;
    this.iThrottle = 0;
    this.iCross = 0;
    this.status.gsCaptured = this.status.locCaptured = false;
  }

  /** Heading (deg) to fly to stay on the runway centreline from the current position. */
  private aprHeading(sim: AircraftSim, r: Runway, dt: number): number {
    const c = runwayCoords(r, sim.pos.x, sim.pos.z);
    // cross-track rate (m/s, + = drifting right of the centreline) damps the intercept so it
    // rolls out on the centreline instead of S-turning across it
    const h = r.headingDeg * DEG;
    const crossRate = sim.vel.x * Math.cos(h) + sim.vel.z * Math.sin(h);
    this.status.locCaptured = Math.abs(c.cross) < 150;
    // integral trims out a steady crosswind drift once established
    if (this.status.locCaptured) this.iCross = clamp(this.iCross + c.cross * 0.0012 * dt, -0.3, 0.3);
    // like a real localizer, tracking tightens as the runway gets closer
    const scale = clamp((r.aimPoint - c.along) * 0.06, 180, 400);
    const corr = -Math.atan((c.cross + crossRate * 12) / scale + this.iCross) / DEG;
    return r.headingDeg + clamp(corr, -30, 30);
  }

  /** Target height on the 3° path to the runway's aim point (m), and distance to it. */
  glidePath(sim: AircraftSim, r: Runway): { target: number; dist: number } {
    const c = runwayCoords(r, sim.pos.x, sim.pos.z);
    const dist = r.aimPoint - c.along;
    return { target: r.threshold.y + Math.max(0, dist) * Math.tan(GS_ANGLE), dist };
  }

  update(sim: AircraftSim, dt: number, out: Controls): Controls {
    const t = this.targets;
    const lateral: LateralMode = t.lateral ?? "hdg";
    let vertical: VerticalMode = t.vertical ?? (t.ias !== undefined && t.altitude === undefined && t.vs === undefined ? "ias" : t.altitude !== undefined ? "alt" : "vs");

    // ---------------- vertical → pitch attitude target ----------------
    let pitchTarget: number;
    if (vertical === "gs" && t.runway) {
      const gp = this.glidePath(sim, t.runway);
      const err = gp.target - sim.pos.y; // + = below the path
      // capture when established on the centreline and within 25 m of the path; from above,
      // descend (up to ~800 fpm) to meet it; from below, hold altitude until it comes down
      if (!this.status.gsCaptured && err > -25 && err < 25 && this.status.locCaptured) this.status.gsCaptured = true;
      if (!this.status.gsCaptured) vertical = err < -25 && this.status.locCaptured ? "vs" : "alt";
    }
    let vsTarget: number;
    if (vertical === "vs" && t.lateral === "apr" && t.runway && !this.status.gsCaptured) {
      // above the path: descend faster than it does (path rate + ~600 fpm) to meet it, but never
      // below minimums before it's captured
      const floor = t.runway.threshold.y + Autopilot.MINIMUMS;
      vsTarget = sim.pos.y > floor + 20 ? -sim.groundSpeed * Math.tan(GS_ANGLE) - 3 : clamp((floor + 20 - sim.pos.y) * 0.15, -2, 2);
      this.status.vertical = "GS*";
    } else if (vertical === "gs" && t.runway) {
      const gp = this.glidePath(sim, t.runway);
      vsTarget = -sim.groundSpeed * Math.tan(GS_ANGLE) + clamp((gp.target - sim.pos.y) * 0.25, -3, 3);
      this.status.vertical = "GS";
    } else if (vertical === "alt" && t.altitude !== undefined) {
      const rate = Math.abs(t.vs ?? 3.5); // m/s used to reach the altitude
      vsTarget = clamp((t.altitude - sim.pos.y) * 0.15, -rate, rate);
      this.status.vertical = Math.abs(t.altitude - sim.pos.y) < 15 ? "ALT" : "ALT*";
    } else {
      vsTarget = t.vs ?? 0;
      this.status.vertical = "VS";
    }
    // overspeed protection with autothrottle at idle: give up descent rate to hold the speed
    if (t.autothrottle && t.ias !== undefined) {
      const over = (sim.ias - (t.ias + 12) * KT) / KT;
      if (over > 0) vsTarget = Math.min(0, vsTarget + over * 0.35);
    }
    if (vertical === "ias" && t.ias !== undefined && !t.autothrottle) {
      const e = (sim.ias - t.ias * KT) / KT; // too fast → nose up
      this.iOuter = clamp(this.iOuter + e * 0.25 * dt, -10, 20);
      pitchTarget = this.iOuter + e * 0.6;
      this.status.vertical = "IAS";
    } else {
      const e = vsTarget - sim.vs;
      this.iOuter = clamp(this.iOuter + e * 0.4 * dt, -10, 20);
      pitchTarget = this.iOuter + e * 0.8;
    }
    pitchTarget = clamp(pitchTarget, -12, 15);
    const err = pitchTarget - sim.pitchDeg;
    this.iPitch = clamp(this.iPitch + err * 0.02 * dt, -0.8, 0.8);
    out.pitch = clamp(err * 0.06 + this.iPitch - sim.w.x * 1.2, -1, 1);

    // ---------------- lateral → bank target ----------------
    let hdgTarget: number | null = t.heading ?? null;
    if (lateral === "apr" && t.runway) {
      hdgTarget = this.aprHeading(sim, t.runway, dt);
      this.status.lateral = this.status.locCaptured ? "APR" : "APR*";
    } else if (lateral === "nav" && t.nav) {
      hdgTarget = (Math.atan2(t.nav.x - sim.pos.x, -(t.nav.z - sim.pos.z)) / DEG + 360) % 360;
      this.status.lateral = "NAV";
    } else {
      this.status.lateral = hdgTarget === null ? "WINGS LVL" : "HDG";
    }
    let bankTarget = 0;
    if (hdgTarget !== null) {
      // fly the ground track (corrects for wind) once moving; standard-rate-ish turns, max 25°
      const track = sim.groundSpeed > 10 ? sim.trackDeg : sim.headingDeg;
      bankTarget = clamp(wrap180(hdgTarget - track) * 1.4, -25, 25);
    }
    out.roll = clamp((bankTarget - sim.bankDeg) * 0.03 + sim.w.z * 0.4, -1, 1);
    out.yaw = sim.onGround ? 0 : clamp(sim.beta * 4, -1, 1);

    // ---------------- autothrottle ----------------
    if (t.autothrottle && t.ias !== undefined) {
      const e = (t.ias * KT - sim.ias) / KT; // knots slow → more power
      this.iThrottle = clamp(this.iThrottle + e * 0.02 * dt, 0, 1);
      out.throttle = clamp(this.iThrottle + e * 0.05 + (sim.vs < -1 ? 0 : 0.05), 0, 1);
    }
    return out;
  }

  /** Below this height (m above the runway) the APR mode hands control back to the pilot. */
  static readonly MINIMUMS = 200 * 0.3048;

  /** In APR: true once the aircraft is at minimums (the game disconnects and the pilot lands). */
  atMinimums(sim: AircraftSim): boolean {
    const r = this.targets.runway;
    return !!r && this.status.gsCaptured && sim.pos.y - r.threshold.y < Autopilot.MINIMUMS;
  }
}

