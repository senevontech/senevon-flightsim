import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { gradeFor, LandingMonitor, scoreLanding, type LandingResult, type TouchdownSample } from "../../gameplay/landing";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Autopilot } from "../autopilot";
import { emptyControls, FPM, KT } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld, HOME } from "../../world/flat/FlatWorld";

declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };

const perfect: TouchdownSample = {
  vsFpm: -120, gPeak: 1.1, centerline: 0.3, fromAim: 10, bankDeg: 0.5, crabDeg: 1, bounced: false, onRunway: true,
};

describe("landing score", () => {
  it("a textbook landing is BUTTER (1000)", () => {
    const r = scoreLanding(perfect);
    expect(r.score).toBe(1000);
    expect(r.grade).toBe("BUTTER");
  });

  it("a firm 450 fpm arrival drops to SMOOTH/FIRM", () => {
    const r = scoreLanding({ ...perfect, vsFpm: -450, gPeak: 1.6 });
    expect(r.score).toBeLessThan(900);
    expect(r.score).toBeGreaterThan(550);
  });

  it("a bounce caps the grade at FIRM", () => {
    const r = scoreLanding({ ...perfect, bounced: true });
    expect(r.score).toBeLessThanOrEqual(749);
    expect(r.grade).toBe("FIRM");
  });

  it("landing off the runway is capped at HARD", () => {
    expect(scoreLanding({ ...perfect, onRunway: false }).score).toBeLessThan(300);
  });

  it("grade thresholds", () => {
    expect(gradeFor(900)).toBe("BUTTER");
    expect(gradeFor(899)).toBe("SMOOTH");
    expect(gradeFor(550)).toBe("FIRM");
    expect(gradeFor(300)).toBe("HARD");
    expect(gradeFor(1)).toBe("ROUGH");
    expect(gradeFor(0)).toBe("CRASH");
  });
});

describe("landing detector (end to end)", () => {
  it("an autopilot approach to runway 36 produces a scored landing", () => {
    const world = new FlatWorld();
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], world);
    const rwy = HOME.runways[0];
    // 1.5 km before the aim point on a 3° path
    const dist = 1500;
    const aimZ = rwy.threshold.z - rwy.aimPoint;
    sim.reset({
      pos: new Vector3(0, dist * Math.tan(3 * Math.PI / 180) + sim.restHeight, aimZ + dist),
      headingDeg: 0, speed: 65 * KT, pathDeg: -3, flaps: 0.67, throttle: 0.3,
    });
    const mon = new LandingMonitor(() => world.airports()[0].runways);
    mon.reset(false);
    let result: LandingResult | null = null;
    mon.onResult = (r) => (result = r);
    const ap = new Autopilot();
    const c = emptyControls();
    c.flaps = 0.67;
    for (let i = 0; i < 120 * 90 && !result; i++) {
      // APR (centreline + 3° glide path, autothrottle 65 kt) down to ~6 m, then a pilot-style
      // flare: hold the centreline, ~100 fpm sink, idle
      const flare = sim.agl < 6;
      ap.targets = flare
        ? { vs: -100 * FPM, lateral: "apr", vertical: "vs", runway: rwy }
        : { lateral: "apr", vertical: "gs", runway: rwy, ias: 65, autothrottle: true };
      if (flare) c.throttle = 0;
      if (sim.onGround) {
        c.pitch = 0;
        c.brakes = 0.5;
      } else ap.update(sim, SIM_DT, c);
      sim.step(SIM_DT, c);
      mon.update(sim, SIM_DT);
    }
    expect(result).not.toBeNull();
    const r = result as unknown as LandingResult;
    if (process.env.FLIGHT_LOG) process.stderr.write(JSON.stringify(r.sample) + "\n");
    expect(r.grade).not.toBe("CRASH");
    expect(r.sample.onRunway).toBe(true);
    expect(r.score).toBeGreaterThan(500);
  });
});
