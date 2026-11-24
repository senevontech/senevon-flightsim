import { it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { emptyControls, KT, type AircraftConfig } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";
declare const process: { stderr: { write(s: string): void } };
const out = (s: string) => process.stderr.write(s + "\n");
function run(fin: number, wingDiff: number, thr: number, secs = 40) {
  const cfg: AircraftConfig = JSON.parse(JSON.stringify(AIRCRAFT["sparrow-s1"]));
  cfg.surfaces.find((s) => s.name === "vfin")!.incidence = fin;
  cfg.surfaces.find((s) => s.name === "wingL")!.incidence = 1.5 + wingDiff;
  cfg.surfaces.find((s) => s.name === "wingR")!.incidence = 1.5 - wingDiff;
  const sim = new AircraftSim(cfg, new FlatWorld());
  sim.reset({ pos: new Vector3(0, 800, 0), headingDeg: 0, speed: 100 * KT, pitchDeg: 1 });
  const c = emptyControls(); c.throttle = thr;
  let maxBank = 0;
  for (let i = 0; i < 120 * secs; i++) { sim.step(SIM_DT, c); maxBank = Math.max(maxBank, Math.abs(sim.bankDeg)); }
  return { bank: sim.bankDeg, hdg: ((sim.headingDeg + 540) % 360) - 180, beta: sim.beta * 57.3, maxBank };
}
it("rig search", () => {
  let best = { score: 1e9, fin: 0, wd: 0 };
  for (let fin = -1.5; fin <= 2.01; fin += 0.25) for (let wd = -0.5; wd <= 0.51; wd += 0.05) {
    const r = run(fin, wd, 0.75);
    const score = r.maxBank + Math.abs(r.hdg) * 0.2;
    if (score < best.score) best = { score, fin, wd };
  }
  out(`best fin ${best.fin} wingDiff ${best.wd}`);
  for (const thr of [0.45, 0.75, 1]) { const r = run(best.fin, best.wd, thr, 60); out(`thr ${thr}: bank ${r.bank.toFixed(1)} maxBank ${r.maxBank.toFixed(1)} hdg ${r.hdg.toFixed(1)} beta ${r.beta.toFixed(2)}`); }
});
