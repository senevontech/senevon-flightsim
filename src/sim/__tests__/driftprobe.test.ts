import { it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Assists } from "../assists";
import { emptyControls, KT } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";
declare const process: { stderr: { write(s: string): void } };
const out = (s: string) => process.stderr.write(s + "\n");
it("drift probe", () => {
  for (const preset of ["easy", "normal", "real"] as const) {
    // takeoff roll, hands off, full power
    let sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, sim.restHeight, 0), headingDeg: 0, speed: 0 });
    let a = new Assists(); a.preset = preset; const raw = emptyControls(); const o = emptyControls();
    raw.throttle = 1;
    for (let i = 0; i < 120 * 12; i++) { a.apply(raw, sim, SIM_DT, o); sim.step(SIM_DT, o); if (sim.ias > 50 * KT) break; }
    out(`${preset} takeoff roll: heading ${(((sim.headingDeg + 540) % 360) - 180).toFixed(1)} x ${sim.pos.x.toFixed(1)} m at ${(sim.ias / KT).toFixed(0)} kt`);
    // cruise hands-off
    for (const thr of [0.65, 1]) {
      sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
      sim.reset({ pos: new Vector3(0, 800, 0), headingDeg: 0, speed: 100 * KT, pitchDeg: 1 });
      a = new Assists(); a.preset = preset; raw.throttle = thr;
      for (let i = 0; i < 120 * 60; i++) { a.apply(raw, sim, SIM_DT, o); sim.step(SIM_DT, o); }
      out(`${preset} cruise thr ${thr}: bank ${sim.bankDeg.toFixed(1)} heading ${(((sim.headingDeg + 540) % 360) - 180).toFixed(1)} beta ${(sim.beta * 57.3).toFixed(2)} alt ${sim.pos.y.toFixed(0)}`);
    }
  }
});
