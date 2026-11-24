/* Landing score (docs/FLIGHT_MODEL.md §10): a pure scoring function + a detector that watches
   the simulation and produces one result per landing. */
import { Vector3 } from "three";
import type { AircraftSim } from "../sim/aircraft";
import { FPM, KT } from "../sim/types";
import { onRunway, runwayCoords, type Runway } from "../world/WorldProvider";

export type Grade = "BUTTER" | "SMOOTH" | "FIRM" | "HARD" | "ROUGH" | "CRASH";

export interface TouchdownSample {
  /** Vertical speed at touchdown, ft/min (negative = descending). */
  vsFpm: number;
  /** Peak load factor in the first second after touchdown. */
  gPeak: number;
  /** Distance of the main gear from the centreline (m). */
  centerline: number;
  /** Distance past (+) or short of (−) the aim point (m). */
  fromAim: number;
  bankDeg: number;
  /** Angle between nose and direction of travel (deg). */
  crabDeg: number;
  bounced: boolean;
  onRunway: boolean;
}

export interface LandingResult {
  score: number;
  grade: Grade;
  sample: TouchdownSample;
  /** 0..1 per factor, for the score screen. */
  parts: { vs: number; g: number; centerline: number; zone: number; attitude: number; bounce: number };
  runway?: string;
}

/** Piecewise-linear lookup: points [x, y] with x ascending. */
function pl(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export const WEIGHTS = { vs: 0.4, g: 0.15, centerline: 0.15, zone: 0.15, attitude: 0.1, bounce: 0.05 };

export function gradeFor(score: number): Grade {
  if (score >= 900) return "BUTTER";
  if (score >= 750) return "SMOOTH";
  if (score >= 550) return "FIRM";
  if (score >= 300) return "HARD";
  if (score > 0) return "ROUGH";
  return "CRASH";
}

export function scoreLanding(s: TouchdownSample): LandingResult {
  const sink = Math.abs(Math.min(s.vsFpm, 0));
  const parts = {
    vs: pl(sink, [[0, 0.97], [30, 1], [180, 1], [400, 0.6], [700, 0.2], [1000, 0]]),
    g: pl(s.gPeak, [[1.3, 1], [2, 0.5], [3, 0]]),
    centerline: pl(Math.abs(s.centerline), [[1, 1], [8, 0.5], [15, 0]]),
    zone: pl(Math.abs(s.fromAim), [[45, 1], [200, 0.5], [450, 0]]),
    attitude: (pl(Math.abs(s.bankDeg), [[2, 1], [10, 0]]) + pl(Math.abs(s.crabDeg), [[3, 1], [15, 0]])) / 2,
    bounce: s.bounced ? 0 : 1,
  };
  let score = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) score += WEIGHTS[k] * parts[k];
  score = Math.round(score * 1000);
  if (s.bounced) score = Math.min(score, 749); // a bounce caps the grade at FIRM
  if (!s.onRunway) score = Math.min(score, 299);
  score = Math.max(score, 1);
  return { score, grade: gradeFor(score), sample: s, parts };
}

export const CRASH_RESULT = (sample: TouchdownSample): LandingResult => ({
  score: 0,
  grade: "CRASH",
  sample,
  parts: { vs: 0, g: 0, centerline: 0, zone: 0, attitude: 0, bounce: 0 },
});

/* ---------------- detector ---------------- */

type Phase = "ground" | "air" | "rollout";

const mid = new Vector3();

export class LandingMonitor {
  private phase: Phase = "ground";
  private airTime = 0;
  private maxAgl = 0;
  private t = 0;
  private offGroundT = 0;
  private sample: TouchdownSample | null = null;
  private runway: Runway | undefined;
  onResult: ((r: LandingResult) => void) | null = null;

  constructor(private runways: () => Runway[]) {}

  reset(onGround: boolean): void {
    this.phase = onGround ? "ground" : "air";
    this.airTime = onGround ? 0 : 10;
    this.maxAgl = onGround ? 0 : 50;
    this.sample = null;
  }

  get armed(): boolean {
    return this.phase === "air" && this.airTime > 1 && this.maxAgl > 3;
  }

  update(sim: AircraftSim, dt: number): void {
    if (sim.crashed) {
      if (this.phase !== "ground") {
        const s = this.sample ?? this.capture(sim);
        this.phase = "ground";
        this.onResult?.(CRASH_RESULT(s));
      }
      return;
    }
    const mainContact = sim.wheels.some((w) => w.main && w.contact);
    switch (this.phase) {
      case "ground":
        if (!sim.onGround) {
          this.phase = "air";
          this.airTime = 0;
          this.maxAgl = 0;
        }
        break;
      case "air":
        this.airTime += dt;
        this.maxAgl = Math.max(this.maxAgl, sim.agl);
        if (sim.onGround) {
          if (this.airTime > 1 && this.maxAgl > 3 && mainContact) {
            this.sample = this.capture(sim);
            this.phase = "rollout";
            this.t = 0;
            this.offGroundT = 0;
          } else if (!this.armed) {
            this.phase = "ground"; // a hop, not a flight
          } else {
            // nose wheel first: still a landing (scored as captured now)
            this.sample = this.capture(sim);
            this.phase = "rollout";
            this.t = 0;
            this.offGroundT = 0;
          }
        }
        break;
      case "rollout": {
        const s = this.sample!;
        this.t += dt;
        if (this.t < 1.2) s.gPeak = Math.max(s.gPeak, sim.gLoad);
        if (!sim.onGround) {
          this.offGroundT += dt;
          if (this.offGroundT > 0.25 && sim.agl > 0.3) {
            s.bounced = true;
          }
          if (sim.agl > 15) {
            // went around: no result, back in the air
            this.phase = "air";
            this.airTime = 2;
            this.maxAgl = sim.agl;
            this.sample = null;
          }
        } else this.offGroundT = 0;
        if (this.phase === "rollout" && (this.t > 4 || (sim.onGround && sim.groundSpeed < 15 * KT && this.t > 1.5))) {
          this.phase = "ground";
          const r = scoreLanding(s);
          r.runway = this.runway?.name;
          this.onResult?.(r);
        }
        break;
      }
    }
  }

  private capture(sim: AircraftSim): TouchdownSample {
    // main-gear midpoint in world space
    mid.set(0, 0, 0);
    let n = 0;
    for (const w of sim.wheels) if (w.main) { mid.add(w.r); n++; }
    mid.multiplyScalar(1 / Math.max(n, 1)).applyQuaternion(sim.q).add(sim.pos);

    // nearest runway by centreline distance; both directions share a strip, so prefer the one
    // whose heading matches the aircraft's
    let best: Runway | undefined, bestD = Infinity;
    for (const r of this.runways()) {
      const c = runwayCoords(r, mid.x, mid.z);
      const hdgDiff = Math.abs(((sim.headingDeg - r.headingDeg + 540) % 360) - 180);
      const d = Math.abs(c.cross) + Math.max(0, -c.along, c.along - r.length) + hdgDiff * 5;
      if (d < bestD) { bestD = d; best = r; }
    }
    this.runway = best;
    const c = best ? runwayCoords(best, mid.x, mid.z) : { along: 0, cross: 99 };
    let crab = sim.headingDeg - sim.trackDeg;
    crab = ((crab + 540) % 360) - 180;
    // a floatplane touching down on the sea: no runway, judged on the touchdown itself
    if (sim.hasFloats && sim.world.surfaceAt(mid.x, mid.z) === "water") {
      this.runway = undefined;
      return {
        vsFpm: sim.prevVel.y / FPM, gPeak: sim.gLoad, centerline: 0, fromAim: 0,
        bankDeg: sim.bankDeg, crabDeg: sim.groundSpeed > 3 ? crab : 0, bounced: false, onRunway: true,
      };
    }
    return {
      vsFpm: sim.prevVel.y / FPM,
      gPeak: sim.gLoad,
      centerline: c.cross,
      fromAim: best ? c.along - best.aimPoint : 999,
      bankDeg: sim.bankDeg,
      crabDeg: sim.groundSpeed > 3 ? crab : 0,
      bounced: false,
      onRunway: !!best && onRunway(best, mid.x, mid.z),
    };
  }
}
