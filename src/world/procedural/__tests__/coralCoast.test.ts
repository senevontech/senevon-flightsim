/* World sanity: runways are flat, approaches are clear of terrain, the region is deterministic,
   a takeoff from the main airport works, and terrain generation is fast enough for the workers. */
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { CoralCoast } from "../coralCoast";
import { ProceduralWorld } from "../ProceduralWorld";
import { AircraftSim, SIM_DT } from "../../../sim/aircraft";
import { emptyControls, KT } from "../../../sim/types";
import { AIRCRAFT } from "../../../aircraft";

declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
const log = (...a: unknown[]) => process.env.FLIGHT_LOG && process.stderr.write(a.join(" ") + "\n");

const cc = new CoralCoast();

describe("Coral Coast region", () => {
  it("is deterministic", () => {
    const other = new CoralCoast();
    for (let i = 0; i < 50; i++) {
      const x = (i * 7919) % 40000 - 20000, z = (i * 104729) % 40000 - 20000;
      expect(other.height(x, z)).toBe(cc.height(x, z));
    }
  });

  it("has 7 airports with flat runways above the sea", () => {
    expect(cc.airports.length).toBe(7);
    for (const a of cc.airports) {
      expect(a.elevation).toBeGreaterThan(2);
      const r = a.runways[0];
      const h = r.headingDeg * Math.PI / 180;
      for (let k = 0; k <= 10; k++) {
        for (const cross of [-r.width / 2, 0, r.width / 2]) {
          const along = (r.length * k) / 10;
          const x = r.threshold.x + Math.sin(h) * along + Math.cos(h) * cross;
          const z = r.threshold.z - Math.cos(h) * along + Math.sin(h) * cross;
          expect(Math.abs(cc.height(x, z) - a.elevation)).toBeLessThan(0.05);
        }
      }
    }
  });

  it("every runway direction has an approach clear of terrain", () => {
    const results: [string, number][] = [];
    for (const a of cc.airports) {
      for (const r of a.runways) {
        const h = r.headingDeg * Math.PI / 180;
        let worst = Infinity, worstD = 0;
        for (let d = 600; d <= 5000; d += 100) {
          const along = r.aimPoint - d;
          const x = r.threshold.x + Math.sin(h) * along, z = r.threshold.z - Math.cos(h) * along;
          const pathY = a.elevation + Math.tan(3 * Math.PI / 180) * d;
          const clr = pathY - Math.max(0, cc.height(x, z));
          if (clr < worst) { worst = clr; worstD = d; }
        }
        log(`${r.id} approach clearance ${worst.toFixed(0)} m at ${worstD} m`);
        results.push([r.id, worst]);
      }
    }
    for (const [, w] of results) expect(w).toBeGreaterThan(20);
  });

  it("generates a terrain chunk's heights quickly (worker budget)", () => {
    const t = performance.now();
    const out = new Float32Array(3);
    for (let j = 0; j < 35; j++) {
      for (let i = 0; i < 35; i++) {
        const x = -3000 + i * 8, z = 2000 + j * 8;
        const h = cc.height(x, z);
        cc.color(x, z, h, 1, out, 0);
      }
    }
    const ms = performance.now() - t;
    log("chunk ms", ms.toFixed(1));
    expect(ms).toBeLessThan(60);
  });
});

describe("flying in the procedural world", () => {
  it("takes off from Coral International without incident", () => {
    const world = new ProceduralWorld();
    const sim = new AircraftSim(AIRCRAFT["sparrow-s1"], world);
    const r = world.airports()[0].runways[0];
    const h = r.headingDeg * Math.PI / 180;
    sim.reset({
      pos: new Vector3(r.threshold.x + Math.sin(h) * 25, r.threshold.y + sim.restHeight, r.threshold.z - Math.cos(h) * 25),
      headingDeg: r.headingDeg, speed: 0,
    });
    const c = emptyControls();
    for (let i = 0; i < 240; i++) sim.step(SIM_DT, c);
    expect(sim.onGround).toBe(true);
    c.throttle = 1;
    let airborne = false;
    for (let i = 0; i < 120 * 40; i++) {
      c.pitch = sim.ias > 55 * KT ? 0.55 : 0;
      let hErr = sim.headingDeg - r.headingDeg;
      hErr = ((hErr + 540) % 360) - 180;
      c.yaw = Math.max(-1, Math.min(1, -hErr * 0.3 + sim.w.y * 3));
      sim.step(SIM_DT, c);
      if (sim.crashed) throw new Error("crashed: " + sim.crashed);
      if (sim.agl > 30) { airborne = true; break; }
    }
    expect(airborne).toBe(true);
  });
});
