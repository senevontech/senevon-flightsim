/* Coral Coast: the starter region. A tropical archipelago (~120 × 120 km) generated from a seed:
   islands shaped by warped noise, coral reefs and lagoons, hills, ridged mountains, two
   volcanoes, and airports whose sites are flattened into the terrain. The inner seven islands
   are the original region; an outer ring (2026-11-28) quadrupled the area.
   This module is pure (no DOM / three.js) so it runs in the terrain workers too. */
import { Simplex2, smoothstep } from "./noise";
import { runwayPair, type Airport, type Runway, type SurfaceType } from "../WorldProvider";

interface Island {
  x: number;
  z: number;
  /** Radius (m). */
  r: number;
  /** Mountain height (m). */
  peak: number;
  volcano?: boolean;
}

interface AirportDef {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
  length: number;
  width: number;
  surface: SurfaceType;
  size: "major" | "regional" | "strip";
}

export const SEED = 20261123;

const ISLANDS: Island[] = [
  { x: 0, z: 0, r: 13500, peak: 650 }, // Corallo (main island)
  { x: -17500, z: -13000, r: 6500, peak: 1100, volcano: true }, // Fuego
  { x: 17500, z: -12500, r: 5200, peak: 320 }, // Turtle
  { x: 16500, z: 15500, r: 4800, peak: 220 }, // Lagoon
  { x: -17500, z: 16500, r: 4000, peak: 260 }, // Sunset
  { x: 23500, z: 1500, r: 2600, peak: 40 }, // Reef atoll
  { x: 3000, z: -22000, r: 3000, peak: 160 }, // Pearl
  // ---- outer ring ----
  { x: -2000, z: -46000, r: 14500, peak: 1500 }, // Northreach (highlands)
  { x: -44000, z: -40000, r: 7500, peak: 1450, volcano: true }, // Ash Rock
  { x: -47000, z: 2000, r: 10500, peak: 900 }, // Mesa Grande
  { x: 2000, z: 46000, r: 11500, peak: 480 }, // Southhaven
  { x: 46000, z: -16000, r: 9000, peak: 320 }, // Long Key
  { x: 40000, z: 30000, r: 6500, peak: 420 }, // Twin North
  { x: 51000, z: 42000, r: 4500, peak: 200 }, // Twin South
  { x: -34000, z: 44000, r: 3200, peak: 50 }, // Gull atoll
];
/** An island can't lift the terrain further than this many radii from its centre. */
const ISLAND_REACH = 1.75;

const AIRPORTS: AirportDef[] = [
  // sites chosen by a search over the raw terrain: lowland, ≤ 22 m relief under the pad, and
  // ≥ 20 m clearance under a 3° glide path out to 5 km in both directions (see the region tests)
  { id: "SKY1", name: "Coral International", x: -6000, z: 6750, heading: 100, length: 2000, width: 45, surface: "asphalt", size: "major" },
  { id: "SKY2", name: "Palm Bay", x: 11250, z: -2500, heading: 50, length: 1100, width: 30, surface: "asphalt", size: "regional" },
  { id: "SKY3", name: "Fuego Strip", x: -11000, z: -5800, heading: 0, length: 800, width: 25, surface: "asphalt", size: "strip" },
  { id: "SKY4", name: "Turtle Island", x: 21500, z: -11250, heading: 20, length: 950, width: 28, surface: "asphalt", size: "regional" },
  { id: "SKY5", name: "Lagoon Field", x: 12950, z: 15750, heading: 150, length: 1000, width: 28, surface: "asphalt", size: "regional" },
  { id: "SKY6", name: "Reef Strip", x: 25000, z: 1250, heading: 120, length: 700, width: 22, surface: "grass", size: "strip" },
  { id: "SKY7", name: "Sunset Hills", x: -19200, z: 13200, heading: 15, length: 650, width: 22, surface: "grass", size: "strip" },
  // outer ring (2026-11-28): same rules — ≤ 22 m relief under the pad, the whole pad on land, and
  // ≥ 30 m under a 3° path out to 5 km both ways (searched over the raw terrain)
  { id: "SKY8", name: "Northreach Highlands", x: 9400, z: -51600, heading: 170, length: 1800, width: 40, surface: "asphalt", size: "major" },
  { id: "SKY9", name: "Mesa Grande", x: -54400, z: -4400, heading: 20, length: 1200, width: 30, surface: "asphalt", size: "regional" },
  { id: "SKY10", name: "Southhaven International", x: -5450, z: 41050, heading: 0, length: 2200, width: 45, surface: "asphalt", size: "major" },
  { id: "SKY11", name: "Long Key", x: 53050, z: -18700, heading: 170, length: 1300, width: 30, surface: "asphalt", size: "regional" },
  { id: "SKY12", name: "Twin North", x: 35550, z: 29550, heading: 170, length: 1000, width: 28, surface: "asphalt", size: "regional" },
  { id: "SKY13", name: "Twin South", x: 47900, z: 41150, heading: 10, length: 800, width: 25, surface: "asphalt", size: "strip" },
  { id: "SKY14", name: "Gull Atoll", x: -32300, z: 44700, heading: 130, length: 650, width: 22, surface: "grass", size: "strip" },
];

/** Half extents of the flattened area around a runway, and the blend distance. */
const FLAT_PAD_LEN = 220;
const FLAT_PAD_WIDTH = 270;
const FLAT_BLEND = 450;

interface FlatZone {
  cx: number;
  cz: number;
  fx: number;
  fz: number;
  halfL: number;
  halfW: number;
  elev: number;
  bound: number;
}

const srgb = (hex: number): [number, number, number] => {
  const f = (v: number) => Math.pow(v / 255, 2.2);
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
};
const C = {
  deep: srgb(0x0b3a62),
  mid: srgb(0x13728f),
  shallow: srgb(0x3ccfc4),
  sand: srgb(0xc8b487),
  wetSand: srgb(0xc8b383),
  grass: srgb(0x5b7b3d),
  lush: srgb(0x3f6531),
  forest: srgb(0x2c5a24),
  dry: srgb(0x8a8f55),
  rock: srgb(0x7b7064),
  lava: srgb(0x3d3632),
  airfield: srgb(0x7aa553),
};

export class CoralCoast {
  readonly n = new Simplex2(SEED);
  readonly n2 = new Simplex2(SEED + 1);
  readonly airports: Airport[];
  readonly airportSizes = new Map<string, AirportDef["size"]>();
  private flats: FlatZone[];
  /** Total extent of the generated terrain (square, centred on 0,0). */
  readonly extent = 131072;

  constructor() {
    this.flats = [];
    this.airports = AIRPORTS.map((a) => {
      const h = (a.heading * Math.PI) / 180;
      const fx = Math.sin(h), fz = -Math.cos(h);
      // elevation: average raw terrain along the runway, kept above the sea
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += this.rawHeight(a.x + fx * (k * a.length) / 4, a.z + fz * (k * a.length) / 4);
      const elev = Math.max(4, Math.round(sum / 5));
      const halfL = a.length / 2 + FLAT_PAD_LEN;
      this.flats.push({ cx: a.x, cz: a.z, fx, fz, halfL, halfW: FLAT_PAD_WIDTH, elev, bound: Math.hypot(halfL, FLAT_PAD_WIDTH) + FLAT_BLEND });
      this.airportSizes.set(a.id, a.size);
      const runways: Runway[] = runwayPair({ x: a.x, z: a.z }, elev, a.heading, a.length, a.width, a.surface);
      for (const r of runways) r.id = `${a.id}-${r.name}`;
      return { id: a.id, name: a.name, elevation: elev, runways };
    });
  }

  /** Terrain before airports are carved in (m, negative = under the sea). */
  rawHeight(x: number, z: number): number {
    const n = this.n;
    const wx = x + n.fbm(x * 0.00022, z * 0.00022, 3) * 2400;
    const wz = z + n.fbm(x * 0.00022 + 50, z * 0.00022 - 80, 3) * 2400;
    let m = -0.7;
    let isl: Island = ISLANDS[0];
    let dRel = 1;
    for (const i of ISLANDS) {
      // beyond ISLAND_REACH radii an island's value (1 − d) is below the open-sea floor (−0.7)
      const reach = i.r * ISLAND_REACH;
      if (Math.abs(wx - i.x) > reach || Math.abs(wz - i.z) > reach) continue;
      const d = Math.hypot(wx - i.x, wz - i.z) / i.r;
      const v = 1 - d;
      if (v > m) {
        m = v;
        isl = i;
        dRel = d;
      }
    }
    m += n.fbm(x / 5200, z / 5200, 4) * 0.17;

    if (m < 0) {
      // reef shelf: shallow lagoon around the islands, then the drop-off
      if (m > -0.12) return m * 35 + n.noise(x / 300, z / 300) * 0.6;
      return -4.2 + (m + 0.12) * 260;
    }
    // coastal plains first, rolling hills inland, mountains in the island cores
    const coastal = smoothstep(0.04, 0.3, m);
    const hills = Math.pow(n.fbm(x / 2300, z / 2300, 5) * 0.5 + 0.5, 1.6) * 70 * coastal;
    let mtn = smoothstep(0.32, 0.9, m) * this.n2.ridged(x / 4300, z / 4300, 6) * isl.peak;
    if (isl.volcano) {
      const cone = Math.pow(Math.max(0, 1 - dRel), 1.7) * isl.peak;
      const crater = isl.peak * 0.18 * smoothstep(0.1, 0.02, dRel);
      mtn = mtn * 0.35 + cone - crater;
    }
    return m * 28 + hills + mtn;
  }

  /** Terrain height including flattened airport sites (may be below sea level). */
  height(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    for (const f of this.flats) {
      const dx = x - f.cx, dz = z - f.cz;
      if (Math.abs(dx) > f.bound || Math.abs(dz) > f.bound) continue;
      const a = dx * f.fx + dz * f.fz;
      const c = -dx * f.fz + dz * f.fx;
      const d = Math.hypot(Math.max(0, Math.abs(a) - f.halfL), Math.max(0, Math.abs(c) - f.halfW));
      if (d < FLAT_BLEND) {
        const w = 1 - smoothstep(0, FLAT_BLEND, d);
        h += (f.elev - h) * w;
      }
    }
    return h;
  }

  /** 1 inside an airport's flattened pad, fading to 0 at the edge of the blend. */
  airportZone(x: number, z: number): number {
    let best = 0;
    for (const f of this.flats) {
      const dx = x - f.cx, dz = z - f.cz;
      if (Math.abs(dx) > f.bound || Math.abs(dz) > f.bound) continue;
      const a = dx * f.fx + dz * f.fz;
      const c = -dx * f.fz + dz * f.fx;
      const d = Math.hypot(Math.max(0, Math.abs(a) - f.halfL), Math.max(0, Math.abs(c) - f.halfW));
      best = Math.max(best, 1 - smoothstep(0, FLAT_BLEND * 0.6, d));
    }
    return best;
  }

  /** Forest density 0..1. */
  forest(x: number, z: number, h: number): number {
    const f = this.n.fbm(x / 1400 + 300, z / 1400 - 120, 4);
    return smoothstep(0.0, 0.3, f) * smoothstep(6, 18, h) * (1 - smoothstep(420, 640, h)) * (1 - this.airportZone(x, z));
  }

  /** Town density 0..1 (lowland, flat-ish, clustered). */
  town(x: number, z: number, h: number): number {
    const t = this.n2.fbm(x / 2600 - 200, z / 2600 + 100, 3);
    return smoothstep(0.3, 0.45, t) * smoothstep(3, 8, h) * (1 - smoothstep(60, 110, h)) * (1 - this.airportZone(x, z) * 0.9);
  }

  /** Linear RGB ground colour. `ny` = normal's up component (1 = flat). */
  color(x: number, z: number, h: number, ny: number, out: Float32Array, o: number): void {
    const mix = (a: number[], b: number[], t: number) => {
      out[o] = a[0] + (b[0] - a[0]) * t;
      out[o + 1] = a[1] + (b[1] - a[1]) * t;
      out[o + 2] = a[2] + (b[2] - a[2]) * t;
    };
    const blendInto = (c: number[], t: number) => {
      out[o] += (c[0] - out[o]) * t;
      out[o + 1] += (c[1] - out[o + 1]) * t;
      out[o + 2] += (c[2] - out[o + 2]) * t;
    };
    if (h < 0) {
      const d = -h;
      if (d < 6) mix(C.shallow, C.mid, d / 6);
      else mix(C.mid, C.deep, Math.min(1, (d - 6) / 50));
      return;
    }
    const v = this.n.noise(x / 180, z / 180) * 0.5 + this.n2.noise(x / 37, z / 37) * 0.25;
    mix(C.grass, C.lush, smoothstep(-0.3, 0.5, v));
    blendInto(C.dry, smoothstep(0.2, 0.7, this.n2.fbm(x / 3000, z / 3000, 2)) * 0.6);
    blendInto(C.forest, this.forest(x, z, h) * 0.85);
    blendInto(C.airfield, this.airportZone(x, z) * 0.8);
    // beaches
    blendInto(C.sand, 1 - smoothstep(0.7, 2.0, h + v * 1.2));
    blendInto(C.wetSand, 1 - smoothstep(0, 0.7, h));
    // rock on steep slopes and high ground; dark volcanic rock above 700 m
    const steep = smoothstep(0.86, 0.72, ny);
    blendInto(C.rock, Math.max(steep, smoothstep(480, 700, h + v * 40)));
    blendInto(C.lava, smoothstep(700, 950, h));
  }

  surfaceAt(x: number, z: number, h = this.height(x, z)): SurfaceType {
    if (h < 0.2) return "water";
    return "grass";
  }
}
