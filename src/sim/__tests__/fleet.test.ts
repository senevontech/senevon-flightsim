/* Flight-test checklist for the whole fleet + the systems each type brings (twin engines,
   retractable gear, floats, jet spool-up). Numbers are realistic for each class. */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Autopilot } from "../autopilot";
import { Assists } from "../assists";
import { emptyControls, FPM, KT, type Controls } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";
import type { SurfaceType, WorldProvider } from "../../world/WorldProvider";

interface Envelope {
  cruise: [number, number, number]; // throttle, min kt, max kt
  climb: [number, number]; // fpm at Vy, full power
  stallClean: [number, number];
  stallFlaps: [number, number];
  takeoff: [number, number]; // ground roll (m)
}

const FLEET: Record<string, Envelope> = {
  "kestrel-k2": { cruise: [0.75, 150, 185], climb: [2000, 3300], stallClean: [52, 63], stallFlaps: [46, 58], takeoff: [120, 300] },
  "otter-b4": { cruise: [0.75, 108, 132], climb: [800, 1500], stallClean: [49, 59], stallFlaps: [40, 50], takeoff: [220, 450] },
  "heron-t2": { cruise: [0.75, 185, 225], climb: [1700, 2900], stallClean: [76, 90], stallFlaps: [60, 74], takeoff: [330, 650] },
  "falcon-j5": { cruise: [0.35, 230, 290], climb: [3000, 5500], stallClean: [95, 110], stallFlaps: [78, 92], takeoff: [600, 1100] },
};

function airborne(id: string, kt: number, alt = 600, flaps = 0) {
  const sim = new AircraftSim(AIRCRAFT[id], new FlatWorld());
  sim.reset({ pos: new Vector3(0, alt, 0), headingDeg: 0, speed: kt * KT, pitchDeg: 1, flaps, gear: 0, throttle: 0.7 });
  return sim;
}

function flyAp(sim: AircraftSim, ap: Autopilot, seconds: number, c: Controls, stop?: () => boolean) {
  for (let i = 0; i < 120 * seconds; i++) {
    ap.update(sim, SIM_DT, c);
    sim.step(SIM_DT, c);
    if (sim.crashed) throw new Error("crashed: " + sim.crashed);
    if (stop?.()) return;
  }
}

const ctl = (throttle: number, flaps = 0, gear = 0): Controls => ({ ...emptyControls(), throttle, flaps, gear });

for (const [id, env] of Object.entries(FLEET)) {
  const cfg = AIRCRAFT[id];
  describe(`${cfg.name} flight test`, () => {
    it(`cruises at ${env.cruise[1]}–${env.cruise[2]} kt (${env.cruise[0] * 100}% power)`, () => {
      const sim = airborne(id, cfg.speeds.vcruise * 0.9);
      const ap = new Autopilot();
      ap.targets = { altitude: 600, heading: 0 };
      flyAp(sim, ap, 240, ctl(env.cruise[0]));
      expect(sim.ias / KT).toBeGreaterThan(env.cruise[1]);
      expect(sim.ias / KT).toBeLessThan(env.cruise[2]);
    });

    it(`climbs at ${env.climb[0]}–${env.climb[1]} fpm`, () => {
      const sim = airborne(id, cfg.speeds.vy);
      const ap = new Autopilot();
      ap.targets = { ias: cfg.speeds.vy, heading: 0 };
      flyAp(sim, ap, 60, ctl(1));
      expect(sim.vs / FPM).toBeGreaterThan(env.climb[0]);
      expect(sim.vs / FPM).toBeLessThan(env.climb[1]);
    });

    for (const [flaps, range] of [[0, env.stallClean], [1, env.stallFlaps]] as const) {
      it(`stalls at ${range[0]}–${range[1]} kt with flaps ${flaps ? "down" : "up"}`, () => {
        const sim = airborne(id, cfg.speeds.vy, 900, flaps);
        const ap = new Autopilot();
        ap.targets = { altitude: 900, heading: 0 };
        let kt = 0;
        flyAp(sim, ap, 150, ctl(0, flaps), () => {
          if (sim.time > 8 && (sim.wingStall > 0.3 || sim.vs < -3)) kt = sim.ias / KT;
          return kt > 0;
        });
        expect(kt).toBeGreaterThan(range[0]);
        expect(kt).toBeLessThan(range[1]);
      });
    }

    it(`takes off in ${env.takeoff[0]}–${env.takeoff[1]} m`, () => {
      const sim = new AircraftSim(cfg, new FlatWorld());
      sim.reset({ pos: new Vector3(0, sim.restHeight, 0), headingDeg: 0, speed: 0, gear: 1 });
      const c = ctl(0, 0, 1);
      for (let i = 0; i < 240; i++) sim.step(SIM_DT, c);
      const z0 = sim.pos.z;
      c.throttle = 1;
      let roll = 0;
      for (let i = 0; i < 120 * 90 && !roll; i++) {
        c.pitch = sim.ias > cfg.speeds.vr * KT ? Math.max(-1, Math.min(1, (10 - sim.pitchDeg) * 0.25 - sim.w.x * 1.5)) : 0;
        const h = ((sim.headingDeg + 540) % 360) - 180;
        c.yaw = Math.max(-1, Math.min(1, -h * 0.3 + sim.w.y * 3));
        sim.step(SIM_DT, c);
        if (sim.crashed) throw new Error("crashed: " + sim.crashed);
        if (!sim.onGround && sim.agl > 1) roll = z0 - sim.pos.z;
      }
      expect(roll).toBeGreaterThan(env.takeoff[0]);
      expect(roll).toBeLessThan(env.takeoff[1]);
    });

    it("flies nearly straight hands-off for a minute (rigging)", () => {
      const sim = airborne(id, cfg.speeds.vcruise * 0.9);
      const c = ctl(0.6);
      let maxBank = 0;
      for (let i = 0; i < 120 * 60; i++) {
        sim.step(SIM_DT, c);
        maxBank = Math.max(maxBank, Math.abs(sim.bankDeg));
      }
      expect(sim.crashed).toBeNull();
      expect(maxBank).toBeLessThan(15);
    });

    it("EASY assists: full roll banks ~50° and the wings level on release", () => {
      const sim = airborne(id, cfg.speeds.vcruise * 0.75, 900);
      const a = new Assists();
      const raw = ctl(0.6);
      const out = emptyControls();
      let held = 0, after = 99;
      for (let i = 0; i < 120 * 16; i++) {
        const t = i * SIM_DT;
        raw.roll = t > 4 && t < 8 ? 1 : 0;
        a.apply(raw, sim, SIM_DT, out);
        sim.step(SIM_DT, out);
        if (sim.crashed) throw new Error("crashed: " + sim.crashed);
        if (t > 7 && t < 8) held = Math.max(held, sim.bankDeg);
        if (t > 8 && after === 99 && Math.abs(sim.bankDeg) < 4) after = t - 8;
      }
      expect(held).toBeGreaterThan(38);
      expect(held).toBeLessThan(58);
      expect(after).toBeLessThan(5);
    });
  });
}

describe("twin engines", () => {
  it("Heron: one engine out — the autopilot holds heading on the good engine", () => {
    const sim = airborne("heron-t2", 130);
    const ap = new Autopilot();
    ap.targets = { altitude: 600, heading: 0 };
    const c = ctl(1);
    flyAp(sim, ap, 10, c);
    sim.failures.engine = "dead"; // left engine
    let worst = 0;
    flyAp(sim, ap, 60, c, () => {
      worst = Math.max(worst, Math.abs(((sim.headingDeg + 540) % 360) - 180));
      return false;
    });
    expect(sim.engineThrust[0]).toBe(0);
    expect(sim.engineThrust[1]).toBeGreaterThan(1000);
    expect(worst).toBeLessThan(10);
  });

  it("asymmetric thrust yaws toward the dead engine when nothing corrects it", () => {
    const sim = airborne("heron-t2", 130);
    sim.failures.engine = "dead";
    const c = ctl(1);
    for (let i = 0; i < 120 * 4; i++) sim.step(SIM_DT, c);
    // left engine dead → right engine pushes → nose swings left (heading decreases)
    expect(((sim.headingDeg + 540) % 360) - 180).toBeLessThan(-2);
  });
});

describe("retractable gear", () => {
  it("raising the gear removes its drag (faster cruise)", () => {
    const speed = (gear: number) => {
      const sim = airborne("heron-t2", 180);
      sim.gearDown = gear;
      const ap = new Autopilot();
      ap.targets = { altitude: 600, heading: 0 };
      flyAp(sim, ap, 150, ctl(0.6, 0, gear));
      return sim.ias / KT;
    };
    expect(speed(0) - speed(1)).toBeGreaterThan(5);
  });

  it("the gear takes its transit time to come down", () => {
    const sim = airborne("falcon-j5", 200);
    const c = ctl(0.4, 0, 1);
    for (let i = 0; i < 120 * 3; i++) sim.step(SIM_DT, c);
    expect(sim.gearDown).toBeGreaterThan(0.3);
    expect(sim.gearDown).toBeLessThan(0.6);
  });

  it("landing with the gear up is a belly landing", () => {
    const sim = new AircraftSim(AIRCRAFT["heron-t2"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, 12, 0), headingDeg: 0, speed: 100 * KT, pathDeg: -2, gear: 0 });
    const c = ctl(0.2, 0.67, 0);
    for (let i = 0; i < 120 * 20 && !sim.crashed; i++) sim.step(SIM_DT, c);
    expect(sim.crashed).toBe("belly");
  });
});

/** All water except a strip of land far away (for float tests). */
class SeaWorld implements WorldProvider {
  heightAt(): number { return 0; }
  surfaceAt(): SurfaceType { return "water"; }
  airports() { return []; }
}

describe("floats (Otter amphibian)", () => {
  it("floats at rest on the water", () => {
    const sim = new AircraftSim(AIRCRAFT["otter-b4"], new SeaWorld());
    sim.reset({ pos: new Vector3(0, 1.6, 0), headingDeg: 0, speed: 0 });
    for (let i = 0; i < 120 * 10; i++) sim.step(SIM_DT, ctl(0));
    expect(sim.crashed).toBeNull();
    expect(Math.abs(sim.vs)).toBeLessThan(0.05);
    expect(sim.pos.y).toBeGreaterThan(1.0);
    expect(Math.abs(sim.bankDeg)).toBeLessThan(2);
  });

  it("takes off from the water", () => {
    const sim = new AircraftSim(AIRCRAFT["otter-b4"], new SeaWorld());
    sim.reset({ pos: new Vector3(0, 1.6, 0), headingDeg: 0, speed: 0 });
    const c = ctl(0, 0.33);
    for (let i = 0; i < 120 * 5; i++) sim.step(SIM_DT, c);
    c.throttle = 1;
    let run = 0;
    for (let i = 0; i < 120 * 90 && !run; i++) {
      c.pitch = sim.ias > 50 * KT ? Math.max(-1, Math.min(1, (8 - sim.pitchDeg) * 0.25 - sim.w.x * 1.5)) : 0.15;
      const h = ((sim.headingDeg + 540) % 360) - 180;
      c.yaw = Math.max(-1, Math.min(1, -h * 0.3 + sim.w.y * 3));
      sim.step(SIM_DT, c);
      if (sim.crashed) throw new Error("crashed: " + sim.crashed);
      if (!sim.onGround && sim.agl > 2) run = -sim.pos.z;
    }
    expect(run).toBeGreaterThan(150);
    expect(run).toBeLessThan(900);
  });

  it("lands on the water without crashing", () => {
    const sim = new AircraftSim(AIRCRAFT["otter-b4"], new SeaWorld());
    sim.reset({ pos: new Vector3(0, 25, 0), headingDeg: 0, speed: 62 * KT, pathDeg: -2, flaps: 0.67 });
    const ap = new Autopilot();
    ap.targets = { vs: -250 * FPM, heading: 0 };
    const c = ctl(0.25, 0.67);
    for (let i = 0; i < 120 * 40 && !sim.onGround; i++) {
      ap.update(sim, SIM_DT, c);
      sim.step(SIM_DT, c);
    }
    expect(sim.onGround).toBe(true);
    c.throttle = 0;
    for (let i = 0; i < 120 * 40; i++) sim.step(SIM_DT, c);
    expect(sim.crashed).toBeNull();
    expect(sim.groundSpeed).toBeLessThan(6); // off the step and down to taxi speed
  });

  it("a wheels-only plane that lands on water ditches", () => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new SeaWorld());
    sim.reset({ pos: new Vector3(0, 3, 0), headingDeg: 0, speed: 55 * KT, pathDeg: -2 });
    for (let i = 0; i < 120 * 10 && !sim.crashed; i++) sim.step(SIM_DT, ctl(0));
    expect(sim.crashed).toBe("water");
  });
});

describe("jet engines", () => {
  it("Falcon turbofans take seconds to spool up", () => {
    const sim = airborne("falcon-j5", 180);
    sim.spool.fill(0);
    const c = ctl(1);
    for (let i = 0; i < 120; i++) sim.step(SIM_DT, c);
    const after1s = sim.thrust;
    for (let i = 0; i < 120 * 8; i++) sim.step(SIM_DT, c);
    expect(after1s).toBeLessThan(sim.thrust * 0.5);
    expect(sim.spool[0]).toBeGreaterThan(0.95);
  });
});
