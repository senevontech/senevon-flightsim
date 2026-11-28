/* WorldProvider for the real-world mode: real elevation (dem.ts) and real airports
   (airportDb.ts) around the chosen airport, in the same local frame as the procedural world
   (+X east, −Z north; geo.ts).

   - Ground: the elevation data, with each runway's site flattened to the airport's published
     elevation (blended out over 450 m, like the procedural airports), so runways are flat and the
     physics and the terrain mesh agree. The sea surface is at 0.
   - Water: elevation at or below 0 away from runways (the sea; inland lakes stay "grass").
   - Airports: the ~80 nearest within 150 km, with every open runway of 1,000 ft or more. */
import { runwayPair, onRunway, type Airport, type Runway, type SurfaceType, type WorldProvider } from "../WorldProvider";
import { GeoFrame, tileXY, type LatLon } from "./geo";
import { DEM_MAX_Z, DemCache } from "./dem";
import type { AirportDb, AirportRec } from "./airportDb";

const FT = 0.3048;
const FLAT_PAD_LEN = 220;
const FLAT_PAD_WIDTH = 150;
const FLAT_BLEND = 450;
const SURF: SurfaceType[] = ["asphalt", "grass", "dirt"];
export const REAL_RADIUS = 150000;

interface FlatZone { cx: number; cz: number; fx: number; fz: number; halfL: number; halfW: number; elev: number; bound: number }

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class RealWorld implements WorldProvider {
  readonly kind = "real" as const;
  readonly frame: GeoFrame;
  readonly home: AirportRec;
  readonly airportList: Airport[] = [];
  readonly airportSizes = new Map<string, "major" | "regional" | "strip">();
  private flats: FlatZone[] = [];
  private ll: LatLon = { lat: 0, lon: 0 };
  private lastReq = { x: NaN, z: NaN };

  constructor(home: AirportRec, db: AirportDb, readonly dem = new DemCache()) {
    this.home = home;
    this.frame = new GeoFrame({ lat: home[5], lon: home[6] });
    const nearby = db.near(this.frame.origin, REAL_RADIUS, 80);
    if (!nearby.includes(home)) nearby.unshift(home);
    for (const rec of nearby) {
      const a = this.toAirport(rec);
      if (a) this.airportList.push(a);
    }
  }

  private toAirport(rec: AirportRec): Airport | null {
    const [ident, name, , , size, lat, lon, elevFt, rwys] = rec;
    const elev = Math.max(1, elevFt * FT);
    const runways: Runway[] = [];
    const ref = this.frame.toWorld(lat, lon);
    // main runway first (paved, then longest): spawns, the map and the menu use runway 0
    const sorted = [...rwys].sort((a, b) => Number(a[8] !== 0) - Number(b[8] !== 0) || b[6] - a[6]);
    for (const r of sorted) {
      const [le, he, leLat, leLon, heLat, heLon, lenFt, widFt, surf, hdgT] = r;
      let cx = ref.x, cz = ref.z, hdg = hdgT, len = lenFt * FT;
      if (leLat !== null && leLon !== null && heLat !== null && heLon !== null) {
        const a = this.frame.toWorld(leLat, leLon), b = this.frame.toWorld(heLat, heLon);
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        if (d > 200) {
          cx = (a.x + b.x) / 2;
          cz = (a.z + b.z) / 2;
          hdg = ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
          len = d;
        }
      }
      const width = Math.min(80, Math.max(15, widFt * FT));
      const pair = runwayPair({ x: cx, z: cz }, elev, hdg, len, width, SURF[surf] ?? "asphalt");
      pair[0].name = le || pair[0].name;
      pair[1].name = he || pair[1].name;
      for (const p of pair) p.id = `${ident}-${p.name}`;
      runways.push(...pair);
      const h = (hdg * Math.PI) / 180;
      const halfL = len / 2 + FLAT_PAD_LEN;
      this.flats.push({ cx, cz, fx: Math.sin(h), fz: -Math.cos(h), halfL, halfW: FLAT_PAD_WIDTH + width / 2, elev, bound: Math.hypot(halfL, FLAT_PAD_WIDTH) + FLAT_BLEND });
    }
    if (!runways.length) return null;
    this.airportSizes.set(ident, size === 2 ? "major" : size === 1 ? "regional" : "strip");
    return { id: ident, name, elevation: elev, runways };
  }

  /** Elevation data only (null where nothing has loaded yet). */
  demHeight(x: number, z: number, zMax = DEM_MAX_Z): number | null {
    this.frame.toLatLon(x, z, this.ll);
    return this.dem.sample(this.ll.lat, this.ll.lon, zMax);
  }

  /** Ground height for rendering and physics, from tiles up to zoom `zMax`. */
  terrainHeight(x: number, z: number, zMax = DEM_MAX_Z): number {
    let h = this.demHeight(x, z, zMax) ?? this.home[7] * FT;
    h = Math.max(0, h);
    for (const f of this.flats) {
      const dx = x - f.cx, dz = z - f.cz;
      if (Math.abs(dx) > f.bound || Math.abs(dz) > f.bound) continue;
      const a = dx * f.fx + dz * f.fz;
      const c = -dx * f.fz + dz * f.fx;
      const d = Math.hypot(Math.max(0, Math.abs(a) - f.halfL), Math.max(0, Math.abs(c) - f.halfW));
      if (d < FLAT_BLEND) h += (f.elev - h) * (1 - smooth(0, FLAT_BLEND, d));
    }
    return h;
  }

  heightAt(x: number, z: number): number {
    return this.terrainHeight(x, z);
  }

  surfaceAt(x: number, z: number): SurfaceType {
    for (const a of this.airportList) for (const r of a.runways) if (onRunway(r, x, z)) return r.surface ?? "asphalt";
    const h = this.demHeight(x, z);
    if (h !== null && h <= 0.2 && this.flatWeight(x, z) < 0.5) return "water";
    return "grass";
  }

  private flatWeight(x: number, z: number): number {
    let w = 0;
    for (const f of this.flats) {
      const dx = x - f.cx, dz = z - f.cz;
      if (Math.abs(dx) > f.bound || Math.abs(dz) > f.bound) continue;
      const a = dx * f.fx + dz * f.fz;
      const c = -dx * f.fz + dz * f.fx;
      const d = Math.hypot(Math.max(0, Math.abs(a) - f.halfL), Math.max(0, Math.abs(c) - f.halfW));
      w = Math.max(w, 1 - smooth(0, FLAT_BLEND, d));
    }
    return w;
  }

  airports(): Airport[] {
    return this.airportList;
  }

  /** Keep the physics' elevation tiles loaded around the aircraft (call every frame). */
  update(x: number, z: number): void {
    if (Math.abs(x - this.lastReq.x) < 300 && Math.abs(z - this.lastReq.z) < 300) return;
    this.lastReq = { x, z };
    this.frame.toLatLon(x, z, this.ll);
    for (const [zoom, r, pri] of [[DEM_MAX_Z, 1, -10], [10, 1, -5]] as const) {
      const t = tileXY(this.ll.lat, this.ll.lon, zoom);
      const tx = Math.floor(t.x), ty = Math.floor(t.y);
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) this.dem.request(zoom, tx + i, ty + j, pri + Math.abs(i) + Math.abs(j));
    }
  }

  /** The detailed elevation tile under a point has arrived (or can't). */
  readyAt(x: number, z: number): boolean {
    this.frame.toLatLon(x, z, this.ll);
    const t = tileXY(this.ll.lat, this.ll.lon, DEM_MAX_Z);
    return this.dem.settled(DEM_MAX_Z, Math.floor(t.x), Math.floor(t.y));
  }
}
