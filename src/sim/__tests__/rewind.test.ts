import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { emptyControls, KT } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";

describe("rewind (snapshot / restore)", () => {
  it("restoring a snapshot and flying the same inputs reproduces the same path (determinism)", () => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, 500, 0), headingDeg: 30, speed: 90 * KT });
    const c = emptyControls();
    c.throttle = 0.7;
    c.roll = 0.3;
    c.pitch = 0.1;
    for (let i = 0; i < 240; i++) sim.step(SIM_DT, c);
    const snap = sim.snapshot();
    for (let i = 0; i < 600; i++) sim.step(SIM_DT, c);
    const endA = sim.pos.clone();
    sim.restore(snap);
    expect(sim.pos.distanceTo(snap.pos)).toBe(0);
    for (let i = 0; i < 600; i++) sim.step(SIM_DT, c);
    expect(sim.pos.distanceTo(endA)).toBeLessThan(1e-6);
  });

  it("restore clears a crash", () => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, 300, 0), headingDeg: 0, speed: 90 * KT, pitchDeg: -60 });
    const snap = sim.snapshot();
    const c = emptyControls();
    for (let i = 0; i < 120 * 20 && !sim.crashed; i++) sim.step(SIM_DT, c);
    expect(sim.crashed).not.toBeNull();
    sim.restore(snap);
    expect(sim.crashed).toBeNull();
    expect(sim.pos.y).toBeCloseTo(300, 5);
  });
});

describe("failures (Mayday)", () => {
  const fly = (setup: (s: AircraftSim) => void, seconds = 30) => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, 1000, 0), headingDeg: 0, speed: 90 * KT });
    setup(sim);
    const c = emptyControls();
    c.throttle = 1;
    for (let i = 0; i < 120 * seconds; i++) sim.step(SIM_DT, c);
    return sim;
  };
  it("a dead engine gives no thrust and the propeller windmills", () => {
    const sim = fly((s) => (s.failures.engine = "dead"), 10);
    expect(sim.thrust).toBe(0);
    expect(sim.rpm).toBeGreaterThan(300);
    expect(sim.rpm).toBeLessThan(1500);
  });
  it("a rough engine loses a good share of its thrust", () => {
    const ok = fly(() => {}, 5).thrust;
    const rough = fly((s) => (s.failures.engine = "rough"), 5).thrust;
    expect(rough).toBeLessThan(ok * 0.85);
    expect(rough).toBeGreaterThan(0);
  });
  it("a fuel leak drains the tanks", () => {
    const sim = fly((s) => (s.failures.fuelLeak = 0.5), 60);
    expect(sim.fuel).toBeLessThan(60);
  });
  it("jammed flaps don't move", () => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, 1000, 0), headingDeg: 0, speed: 70 * KT });
    sim.failures.flapsJammed = true;
    const c = emptyControls();
    c.flaps = 1;
    for (let i = 0; i < 120 * 5; i++) sim.step(SIM_DT, c);
    expect(sim.flaps).toBe(0);
  });
  it("reset clears failures", () => {
    const sim = fly((s) => (s.failures.engine = "dead"), 1);
    sim.reset({ pos: new Vector3(0, 1000, 0), headingDeg: 0, speed: 90 * KT });
    expect(sim.failures.engine).toBe("ok");
  });
});
