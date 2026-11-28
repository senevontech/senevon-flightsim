import { describe, expect, it } from "vitest";
import { distanceM, GeoFrame, terrarium, tileLatLon, tileSizeM, tileXY } from "../geo";

describe("geo", () => {
  const f = new GeoFrame({ lat: 51.47, lon: -0.46 }); // near London Heathrow

  it("puts north at −z and east at +x, with true distances near the origin", () => {
    const n = f.toWorld(51.47 + 0.1, -0.46);
    expect(n.x).toBeCloseTo(0);
    expect(n.z).toBeLessThan(0);
    expect(Math.abs(n.z)).toBeCloseTo(11119.5, 0); // 0.1° of latitude
    const e = f.toWorld(51.47, -0.46 + 0.1);
    expect(e.x).toBeGreaterThan(0);
    expect(e.x).toBeCloseTo(distanceM({ lat: 51.47, lon: -0.46 }, { lat: 51.47, lon: -0.36 }), -1);
  });

  it("round-trips world ↔ lat/lon", () => {
    for (const [x, z] of [[0, 0], [12345, -67890], [-90000, 40000]]) {
      const ll = f.toLatLon(x, z);
      const w = f.toWorld(ll.lat, ll.lon);
      expect(w.x).toBeCloseTo(x, 3);
      expect(w.z).toBeCloseTo(z, 3);
    }
  });

  it("keeps distance errors small out to 150 km", () => {
    const o = { lat: 51.47, lon: -0.46 };
    for (const [dLat, dLon] of [[1.3, 0], [0, 2], [0.9, 1.4], [-1, -1.6]]) {
      const p = { lat: o.lat + dLat, lon: o.lon + dLon };
      const w = f.toWorld(p.lat, p.lon);
      const err = Math.abs(Math.hypot(w.x, w.z) - distanceM(o, p)) / distanceM(o, p);
      expect(err).toBeLessThan(0.012);
    }
  });

  it("wraps across the antimeridian", () => {
    const g = new GeoFrame({ lat: -17.75, lon: 179.9 }); // Fiji
    const w = g.toWorld(-17.75, -179.9);
    expect(w.x).toBeGreaterThan(0);
    expect(w.x).toBeLessThan(25000);
    expect(g.toLatLon(w.x, w.z).lon).toBeCloseTo(-179.9, 6);
  });

  it("converts Web Mercator tiles both ways", () => {
    const t = tileXY(51.47, -0.46, 12);
    const back = tileLatLon(t.x, t.y, 12);
    expect(back.lat).toBeCloseTo(51.47, 6);
    expect(back.lon).toBeCloseTo(-0.46, 6);
    expect(Math.floor(t.x)).toBe(2042);
    expect(Math.floor(t.y)).toBe(1362);
    expect(tileSizeM(0, 0)).toBeCloseTo(2 * Math.PI * 6371008.8, 0); // the equator
  });

  it("decodes terrarium pixels", () => {
    expect(terrarium(128, 0, 0)).toBe(0);
    expect(terrarium(128, 100, 128)).toBe(100.5);
    expect(terrarium(127, 246, 0)).toBe(-10);
  });
});
