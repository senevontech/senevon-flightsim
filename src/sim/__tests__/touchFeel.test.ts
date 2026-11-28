/* Phone-stick feel through the assist layer (the default Easy preset): the plane must fly level
   hands-off, take off cleanly with a half pull, and answer the stick in proportion — a quarter
   stick does something, half stick a clear turn. Guards the bugs fixed on 2026-11-28: a stale
   angle-of-attack rate at liftoff made the stall guard shove the nose down, and a doubled
   response curve made the middle of the phone stick feel dead. */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { AircraftSim, SIM_DT } from "../aircraft";
import { Assists, type AssistPreset } from "../assists";
import { emptyControls, FPM, KT } from "../types";
import { AIRCRAFT } from "../../aircraft";
import { FlatWorld } from "../../world/flat/FlatWorld";
import { stickAxis } from "../../input/touch";

declare const process: { env: Record<string, string | undefined> };

function airborne(preset: AssistPreset) {
  const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
  sim.reset({ pos: new Vector3(0, 800, 0), headingDeg: 0, speed: 95 * KT, pitchDeg: 1, flaps: 0, gear: 1, throttle: 0.65 });
  const assists = new Assists();
  assists.preset = preset;
  const raw = emptyControls(), out = emptyControls();
  raw.throttle = 0.65;
  const fly = (s: number) => {
    for (let i = 0; i < 120 * s; i++) {
      assists.apply(raw, sim, SIM_DT, out);
      sim.step(SIM_DT, out);
    }
  };
  return { sim, raw, fly };
}

describe("phone stick feel (Easy)", () => {
  it("flies level hands-off right after spawning in the air", () => {
    const { sim, fly } = airborne("easy");
    fly(3);
    expect(Math.abs(sim.vel.y / FPM)).toBeLessThan(250);
    expect(Math.abs(sim.pitchDeg - 1)).toBeLessThan(2);
  });

  it("doesn't swing into a crosswind on its own after an airborne spawn", () => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.wind = { fromDeg: 90, speed: 12 * KT, gust: 0, turbulence: 0 }; // straight across
    sim.reset({ pos: new Vector3(0, 800, 0), headingDeg: 0, speed: 95 * KT, pitchDeg: 1, flaps: 0, gear: 1, throttle: 0.65 });
    const assists = new Assists();
    const raw = emptyControls(), out = emptyControls();
    raw.throttle = 0.65;
    for (let i = 0; i < 120 * 30; i++) {
      assists.apply(raw, sim, SIM_DT, out);
      sim.step(SIM_DT, out);
    }
    expect(Math.abs(((sim.headingDeg + 540) % 360) - 180)).toBeLessThan(1.5);
  });

  it("answers the stick in proportion", () => {
    const bankAt = (thumb: number) => {
      const { sim, raw, fly } = airborne("easy");
      fly(1);
      raw.roll = stickAxis(thumb);
      fly(2);
      return sim.bankDeg;
    };
    const quarter = bankAt(0.25), half = bankAt(0.5), full = bankAt(1);
    expect(quarter).toBeGreaterThan(5);
    expect(half).toBeGreaterThan(15);
    expect(full).toBeGreaterThan(half);
    expect(half / full).toBeGreaterThan(0.35); // not dead in the middle
  });

  it("takes off cleanly with a half pull and keeps a safe climb when the stick is let go", () => {
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], new FlatWorld());
    sim.reset({ pos: new Vector3(0, sim.restHeight, 0), headingDeg: 0, speed: 0, gear: 1 });
    const assists = new Assists();
    const raw = emptyControls(), out = emptyControls();
    raw.throttle = 1;
    let liftoff = -1, minPitchAfter = Infinity, minVsAfter = Infinity, minIas = Infinity;
    for (let i = 0; i < 120 * 40; i++) {
      const t = i * SIM_DT;
      raw.pitch = sim.ias > 55 * KT && (liftoff < 0 || t - liftoff < 2) ? stickAxis(0.5) : 0;
      assists.apply(raw, sim, SIM_DT, out);
      sim.step(SIM_DT, out);
      if (sim.crashed) throw new Error("crashed: " + sim.crashed);
      if (liftoff < 0 && !sim.onGround && sim.agl > 1) liftoff = t;
      if (liftoff >= 0 && t - liftoff > 0.5 && t - liftoff < 12) {
        minPitchAfter = Math.min(minPitchAfter, sim.pitchDeg);
        minVsAfter = Math.min(minVsAfter, sim.vel.y / FPM);
        minIas = Math.min(minIas, sim.ias / KT);
      }
    }
    if (process.env.FEEL_LOG) console.log({ liftoff, minPitchAfter, minVsAfter, minIas, ias: sim.ias / KT, agl: sim.agl, pitch: sim.pitchDeg });
    expect(liftoff).toBeGreaterThan(0);
    expect(minPitchAfter).toBeGreaterThan(2); // the nose is never shoved down after liftoff
    expect(minVsAfter).toBeGreaterThan(100); // climbing the whole time
    expect(minIas).toBeGreaterThan(60); // let go after a steep pull: settles, no stall-horn speeds
  });
});
