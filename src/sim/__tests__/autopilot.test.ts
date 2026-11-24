import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Autopilot, type ApTargets } from "../autopilot";
import { emptyControls, FPM, KT } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld, HOME } from "../../world/flat/FlatWorld";
import { runwayCoords } from "../../world/WorldProvider";

function setup(x: number, y: number, z: number, heading: number, kt = 100) {
  const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
  sim.reset({ pos: new Vector3(x, y, z), headingDeg: heading, speed: kt * KT, pitchDeg: 1 });
  const ap = new Autopilot();
  const c = emptyControls();
  c.throttle = 0.7;
  return { sim, ap, c };
}

function fly(sim: AircraftSim, ap: Autopilot, c: ReturnType<typeof emptyControls>, targets: ApTargets, seconds: number, stop?: () => boolean) {
  ap.targets = targets;
  for (let i = 0; i < 120 * seconds; i++) {
    ap.update(sim, SIM_DT, c);
    sim.step(SIM_DT, c);
    if (sim.crashed) throw new Error("crashed: " + sim.crashed);
    if (stop?.()) break;
  }
}

describe("autopilot", () => {
  it("ALT: climbs at the selected rate and captures the altitude", () => {
    const { sim, ap, c } = setup(0, 300, 0, 0);
    c.throttle = 0.9;
    let maxVs = 0;
    ap.targets = { altitude: 600, vs: 500 * FPM, heading: 0 };
    for (let i = 0; i < 120 * 180; i++) {
      ap.update(sim, SIM_DT, c);
      sim.step(SIM_DT, c);
      if (i > 120 * 10) maxVs = Math.max(maxVs, sim.vs);
    }
    expect(Math.abs(sim.pos.y - 600)).toBeLessThan(8);
    expect(maxVs / FPM).toBeLessThan(620); // respected the 500 fpm selection (with a little overshoot)
  });

  it("HDG: turns to and holds a heading", () => {
    const { sim, ap, c } = setup(0, 600, 0, 0);
    fly(sim, ap, c, { altitude: 600, heading: 270 }, 60);
    expect(Math.abs(((sim.headingDeg - 270 + 540) % 360) - 180)).toBeLessThan(3);
  });

  it("NAV: flies to a point 6 km away", () => {
    const { sim, ap, c } = setup(0, 600, 0, 90);
    const target = { x: -3000, z: -5000 };
    let closest = Infinity;
    fly(sim, ap, c, { altitude: 600, lateral: "nav", nav: target }, 200, () => {
      closest = Math.min(closest, Math.hypot(sim.pos.x - target.x, sim.pos.z - target.z));
      return closest < 150;
    });
    expect(closest).toBeLessThan(150);
  });

  // realistic intercepts: slightly above the 3° path, and the standard one from below it
  for (const [label, y] of [["above", 450], ["below", 300]] as const) {
    it(`APR: from 1.5 km off the centreline and ${label} the glide path, in a crosswind, arrives on centreline + path`, () => {
      const rwy = HOME.runways[0];
      const { sim, ap, c } = setup(rwy.threshold.x + 1500, y, rwy.threshold.z + 7000, 330, 90);
      sim.wind = { fromDeg: 270, speed: 6, gust: 0, turbulence: 0 };
      c.flaps = 0.67; // approach configuration: like a real pilot, the drag lets it descend steeply
      let atMins = false;
      fly(sim, ap, c, { lateral: "apr", vertical: "gs", runway: rwy, altitude: y, ias: 75, autothrottle: true }, 300, () => {
        atMins = ap.atMinimums(sim);
        return atMins;
      });
      expect(atMins).toBe(true);
      const cr = runwayCoords(rwy, sim.pos.x, sim.pos.z);
      const gp = ap.glidePath(sim, rwy);
      expect(Math.abs(cr.cross)).toBeLessThan(12); // on the centreline
      expect(Math.abs(sim.pos.y - gp.target)).toBeLessThan(10); // on the glide path
      expect(Math.abs(sim.ias / KT - 75)).toBeLessThan(8); // autothrottle holding speed
    });
  }

  it("autothrottle holds the selected speed in level flight", () => {
    const { sim, ap, c } = setup(0, 600, 0, 0, 80);
    fly(sim, ap, c, { altitude: 600, heading: 0, ias: 95, autothrottle: true }, 120);
    expect(Math.abs(sim.ias / KT - 95)).toBeLessThan(4);
  });
});
