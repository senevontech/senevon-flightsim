/* Flight-test checklist for the Sparrow S1 (docs/FLIGHT_MODEL.md §9).
   Each test flies the real simulation with the autopilot and checks steady-state numbers. */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Autopilot } from "../autopilot";
import { emptyControls, FPM, KT } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";

declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };

const cfg = AIRCRAFT["sparrow-s1"];
const LOG = !!process.env.FLIGHT_LOG;
const log = (...a: unknown[]) => process.stderr.write(a.join(" ") + "\n");

function airborne(speedKt: number, alt = 300, flaps = 0) {
  const sim = new AircraftSim(cfg, new FlatWorld());
  sim.reset({ pos: new Vector3(0, alt, 0), headingDeg: 0, speed: speedKt * KT, pitchDeg: 2, flaps });
  return sim;
}

function fly(sim: AircraftSim, ap: Autopilot, seconds: number, throttle: number, flaps = 0, each?: () => boolean | void) {
  const c = emptyControls();
  c.throttle = throttle;
  c.flaps = flaps;
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    ap.update(sim, SIM_DT, c);
    sim.step(SIM_DT, c);
    if (sim.crashed) throw new Error("crashed: " + sim.crashed);
    if (each && each()) break;
  }
}

describe("Sparrow S1 flight test", () => {
  it("cruises at about 110 kt at 75% power", () => {
    const sim = airborne(100);
    const ap = new Autopilot();
    ap.targets = { altitude: 300, heading: 0 };
    fly(sim, ap, 240, 0.75);
    const kt = sim.ias / KT;
    if (LOG) log("cruise kt", kt.toFixed(1), "alt", sim.pos.y.toFixed(1), "aoa", (sim.aoa * 57.3).toFixed(2), "trim pitch", sim.pitchDeg.toFixed(2));
    expect(Math.abs(sim.pos.y - 300)).toBeLessThan(10);
    expect(kt).toBeGreaterThan(100);
    expect(kt).toBeLessThan(122);
  });

  it("climbs at 600–900 fpm at Vy with full power", () => {
    const sim = airborne(74, 300);
    const ap = new Autopilot();
    ap.targets = { ias: 74, heading: 0 };
    fly(sim, ap, 60, 1);
    const fpm = sim.vs / FPM;
    if (LOG) log("climb fpm", fpm.toFixed(0), "ias", (sim.ias / KT).toFixed(1));
    expect(fpm).toBeGreaterThan(600);
    expect(fpm).toBeLessThan(900);
  });

  for (const [flaps, lo, hi] of [[0, 44, 53], [1, 36, 45]] as const) {
    it(`stalls at ${lo}–${hi} kt with flaps ${flaps}`, () => {
      const sim = airborne(70, 500, flaps);
      const ap = new Autopilot();
      ap.targets = { altitude: 500, heading: 0 };
      let stallKt = 0;
      fly(sim, ap, 120, 0, flaps, () => {
        // stall = wing flow separating, or can no longer hold altitude
        if (sim.time > 8 && (sim.wingStall > 0.3 || sim.vs < -3)) {
          stallKt = sim.ias / KT;
          return true;
        }
      });
      if (LOG) log("stall flaps", flaps, "kt", stallKt.toFixed(1));
      expect(stallKt).toBeGreaterThan(lo);
      expect(stallKt).toBeLessThan(hi);
    });
  }

  it("takes off in 200–400 m and rotates at Vr", () => {
    const world = new FlatWorld();
    const sim = new AircraftSim(cfg, world);
    sim.reset({ pos: new Vector3(0, sim.restHeight, 0), headingDeg: 0, speed: 0 });
    const c = emptyControls();
    // settle on the gear
    for (let i = 0; i < 240; i++) sim.step(SIM_DT, c);
    expect(sim.onGround).toBe(true);
    const z0 = sim.pos.z;
    c.throttle = 1;
    let liftoff = 0;
    for (let i = 0; i < 120 * 60; i++) {
      // rotate like a pilot: ease the nose up to a ~10° attitude, don't yank it
      c.pitch = sim.ias > cfg.speeds.vr * KT ? Math.max(-1, Math.min(1, (10 - sim.pitchDeg) * 0.12 - sim.w.x * 1.5)) : 0;
      // keep straight: heading error (deg, + = nose right of 0) → rudder left; damp yaw rate (w.y + = nose left)
      const hErr = sim.headingDeg > 180 ? sim.headingDeg - 360 : sim.headingDeg;
      c.yaw = Math.max(-1, Math.min(1, -hErr * 0.3 + sim.w.y * 3));
      sim.step(SIM_DT, c);
      if (sim.crashed) throw new Error("crashed: " + sim.crashed);
      if (!sim.onGround && sim.agl > 1) {
        liftoff = z0 - sim.pos.z;
        break;
      }
    }
    if (LOG) log("takeoff roll m", liftoff.toFixed(0), "ias", (sim.ias / KT).toFixed(1), "heading", sim.headingDeg.toFixed(1), "x drift", sim.pos.x.toFixed(1));
    expect(liftoff).toBeGreaterThan(200);
    expect(liftoff).toBeLessThan(400);
  });

  it("rests level on its gear without drifting", () => {
    const sim = new AircraftSim(cfg, new FlatWorld());
    sim.reset({ pos: new Vector3(0, sim.restHeight + 0.2, 0), headingDeg: 90, speed: 0 });
    const c = emptyControls();
    c.brakes = 1;
    for (let i = 0; i < 120 * 10; i++) sim.step(SIM_DT, c);
    if (LOG) log("rest pitch", sim.pitchDeg.toFixed(2), "bank", sim.bankDeg.toFixed(2), "speed", sim.vel.length().toFixed(3));
    expect(sim.crashed).toBeNull();
    expect(sim.vel.length()).toBeLessThan(0.05);
    expect(Math.abs(sim.pitchDeg)).toBeLessThan(3);
    expect(Math.abs(sim.bankDeg)).toBeLessThan(0.5);
  });

  it("is stable hands-off for 60 s (no divergence)", () => {
    const sim = airborne(100, 600);
    const c = emptyControls();
    c.throttle = 0.65;
    for (let i = 0; i < 120 * 60; i++) sim.step(SIM_DT, c);
    if (LOG) log("hands-off bank", sim.bankDeg.toFixed(1), "pitch", sim.pitchDeg.toFixed(1), "ias", (sim.ias / KT).toFixed(1), "alt", sim.pos.y.toFixed(0));
    expect(sim.crashed).toBeNull();
    expect(Math.abs(sim.bankDeg)).toBeLessThan(45);
    expect(sim.ias / KT).toBeGreaterThan(50);
    expect(sim.ias / KT).toBeLessThan(150);
  });
});
