import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { MAYDAYS, MaydayDirector } from "../mayday";
import { weatherFromPreset, weatherText } from "../weather";
import { AircraftSim, SIM_DT } from "../../sim/aircraft";
import { emptyControls, KT } from "../../sim/types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";

describe("Mayday director", () => {
  it("exactly one scenario is free", () => {
    expect(MAYDAYS.filter((m) => m.free).map((m) => m.id)).toEqual(["engine_out"]);
  });

  for (const def of MAYDAYS) {
    it(`${def.id} triggers within 15 s and applies its failure once`, () => {
      const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
      sim.reset({ pos: new Vector3(0, 800, 0), headingDeg: 0, speed: 100 * KT });
      const d = new MaydayDirector();
      d.start(def, sim);
      const c = emptyControls();
      c.throttle = 0.65;
      let fired = 0;
      for (let i = 0; i < 120 * 15; i++) {
        sim.step(SIM_DT, c);
        if (d.update(sim)) fired++;
      }
      expect(fired).toBe(1);
      const f = sim.failures;
      if (def.id === "engine_out") expect(f.engine).toBe("dead");
      if (def.id === "rough_engine" || def.id === "bird_strike") expect(f.engine).toBe("rough");
      if (def.id === "fuel_leak") expect(f.fuelLeak).toBeGreaterThan(0);
      if (def.id === "flap_jam") expect(f.flapsJammed).toBe(true);
      if (def.id === "electrical") expect(f.electrical).toBe(true);
      if (def.id === "bird_strike") expect(d.cracked).toBe(true);
    });
  }
});

describe("weather", () => {
  it("reads like a report", () => {
    expect(weatherText(weatherFromPreset("storm", 104))).toBe("wind 100 at 26 gusting 42, visibility 4.0 km");
    expect(weatherText(weatherFromPreset("clear", 0))).toBe("wind 360 at 5, visibility 70 km");
  });
});
