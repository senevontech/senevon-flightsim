/* Geography for the real-world mode.

   World frame: a local tangent plane centred on the chosen airport (the origin), +X east,
   +Y up, −Z north — the same frame as the procedural world, so the sim, cameras and HUD are
   unchanged. The projection is equirectangular about the origin's latitude: within ~150 km the
   distance error stays under ~0.3 %, well inside what a flight game needs. Earth curvature is
   added in the terrain shader (the horizon drops by d²/2R), not here.

   Tiles: Web Mercator XYZ ("slippy map") tiles, as served by the terrain and imagery sources. */

export const EARTH_R = 6371008.8;
const D = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

export class GeoFrame {
  private kx: number; // metres per degree of longitude at the origin
  private kz: number; // metres per degree of latitude

  constructor(readonly origin: LatLon) {
    this.kz = EARTH_R * D;
    this.kx = this.kz * Math.cos(origin.lat * D);
  }

  /** Latitude / longitude → world x (east), z (south). */
  toWorld(lat: number, lon: number, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
    let dLon = lon - this.origin.lon;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    out.x = dLon * this.kx;
    out.z = -(lat - this.origin.lat) * this.kz;
    return out;
  }

  /** World x, z → latitude / longitude. */
  toLatLon(x: number, z: number, out: LatLon = { lat: 0, lon: 0 }): LatLon {
    out.lat = this.origin.lat - z / this.kz;
    let lon = this.origin.lon + x / this.kx;
    if (lon > 180) lon -= 360;
    else if (lon < -180) lon += 360;
    out.lon = lon;
    return out;
  }
}

/** Great-circle distance (m). */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * D, dLon = (b.lon - a.lon) * D;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- Web Mercator tiles ----
const MAX_LAT = 85.05112878;

/** Fractional tile coordinates of a point at zoom z. */
export function tileXY(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n,
  };
}

/** Latitude / longitude of fractional tile coordinates at zoom z (tile corner for integers). */
export function tileLatLon(x: number, y: number, z: number, out: LatLon = { lat: 0, lon: 0 }): LatLon {
  const n = 2 ** z;
  out.lon = (x / n) * 360 - 180;
  out.lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / D;
  return out;
}

/** Ground width of one tile at zoom z and latitude (m). */
export function tileSizeM(z: number, lat: number): number {
  return (2 * Math.PI * EARTH_R * Math.cos(lat * D)) / 2 ** z;
}

export const tileKey = (z: number, x: number, y: number) => `${z}/${x}/${y}`;

/** Terrarium PNG pixel → elevation (m). */
export const terrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;
