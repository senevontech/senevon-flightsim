/* Real-world provider with stubbed elevation tiles: runways are flat at the published elevation,
   physics and terrain agree, the sea is water, the airport search ranks sensibly, and real
   runways keep their names and the main paved runway comes first. */
import { describe, expect, it } from "vitest";
import { AirportDb, type AirportRec } from "../airportDb";
import { DemCache, packHeight } from "../dem";
import { tileXY } from "../geo";
import { RealWorld } from "../RealWorld";
import { runwayCoords } from "../../WorldProvider";

// a made-up valley town with a paved runway 08/26 and a grass strip, plus a coastal neighbour
const HOME: AirportRec = ["TEST", "Test Valley Airport", "Testville", "XX", 1, 47.26, 11.34, 1900, [
  ["08G", "26G", null, null, null, null, 2000, 60, 1, 80],
  ["08", "26", 47.258, 11.32, 47.262, 11.365, 6562, 148, 0, 80],
]];
const COAST: AirportRec = ["SEA1", "Seaside Field", "Portside", "XX", 0, 47.0, 11.6, 10, [["18", "36", null, null, null, null, 3000, 75, 0, 180]]];
const BIG: AirportRec = ["BIGX", "Big International", "Testville", "XX", 2, 48.5, 12.5, 400, [["09", "27", null, null, null, null, 12000, 150, 0, 90]]];
const db = new AirportDb([BIG, HOME, COAST]);

/** Elevation stub: a 600 m valley floor rising to 2,500 m to the north; sea south of 47.1°N. */
function stubDem(): DemCache {
  const dem = new DemCache(() => Promise.reject(new Error("offline")));
  const fill = (z: number) => {
    for (const [lat, lon] of [[47.26, 11.34], [47.0, 11.6], [47.3, 11.3]]) {
      const t = tileXY(lat, lon, z);
      const tx = Math.floor(t.x), ty = Math.floor(t.y);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const data = new Uint16Array(256 * 256);
        for (let py = 0; py < 256; py++) {
          // latitude of this pixel row
          const n = 2 ** z, yy = (ty + j + (py + 0.5) / 256) / n;
          const la = (Math.atan(Math.sinh(Math.PI * (1 - 2 * yy))) * 180) / Math.PI;
          const h = la < 47.1 ? -40 : 580 + Math.max(0, la - 47.27) * 40000;
          data.fill(packHeight(Math.min(h, 2500)), py * 256, py * 256 + 256);
        }
        dem.put(z, tx + i, ty + j, data);
      }
    }
  };
  fill(13);
  fill(10);
  return dem;
}

describe("real world", () => {
  const world = new RealWorld(HOME, db, stubDem());

  it("centres on the home airport and lists it first", () => {
    expect(world.airports()[0].id).toBe("TEST");
    expect(world.airports().map((a) => a.id)).toContain("SEA1");
    expect(world.airports().map((a) => a.id)).not.toContain("BIGX"); // ~170 km away
  });

  it("puts the main paved runway first, with its real names", () => {
    const rw = world.airports()[0].runways;
    expect(rw.map((r) => r.name)).toEqual(["08", "26", "08G", "26G"]);
    expect(rw[0].surface).toBe("asphalt");
    expect(rw[2].surface).toBe("grass");
    // ends from the data: ~3.4 km apart, heading ~80°
    expect(rw[0].length).toBeGreaterThan(3300);
    expect(rw[0].headingDeg).toBeGreaterThan(75);
    expect(rw[0].headingDeg).toBeLessThan(85);
  });

  it("flattens the runway to the published elevation", () => {
    const a = world.airports()[0], r = a.runways[0];
    const h = (r.headingDeg * Math.PI) / 180;
    for (let k = 0; k <= 10; k++) {
      const along = (r.length * k) / 10;
      const x = r.threshold.x + Math.sin(h) * along, z = r.threshold.z - Math.cos(h) * along;
      expect(world.heightAt(x, z)).toBeCloseTo(1900 * 0.3048, 3);
      expect(world.surfaceAt(x, z)).toBe("asphalt");
      expect(runwayCoords(r, x, z).cross).toBeCloseTo(0, 6);
    }
  });

  it("follows the elevation data away from airports, physics and terrain alike", () => {
    const p = world.frame.toWorld(47.35, 11.2); // up the mountainside
    const h = world.heightAt(p.x, p.z);
    expect(h).toBeGreaterThan(2000);
    expect(world.terrainHeight(p.x, p.z)).toBe(h);
  });

  it("treats the sea as water at height 0", () => {
    const p = world.frame.toWorld(47.02, 11.4);
    expect(world.heightAt(p.x, p.z)).toBe(0);
    expect(world.surfaceAt(p.x, p.z)).toBe("water");
  });

  it("is ready where the detailed elevation tile is loaded", () => {
    expect(world.readyAt(0, 0)).toBe(true);
  });
});

describe("airport search", () => {
  it("finds by code first, then by name or town, bigger airports first", () => {
    expect(db.search("test")[0].ident).toBe("TEST");
    expect(db.search("bigx")[0].ident).toBe("BIGX");
    const town = db.search("testville").map((h) => h.ident);
    expect(town).toEqual(["BIGX", "TEST"]);
    expect(db.search("x")).toEqual([]); // too short
    expect(db.search("seaside portside")[0].ident).toBe("SEA1");
  });
});
