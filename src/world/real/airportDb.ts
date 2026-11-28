/* Real airports (OurAirports, public domain), built by tools/build-airports.py into
   public/data/airports.json and loaded only in the real-world mode. */
import { distanceM, type LatLon } from "./geo";

/** [ident, name, place, country, size 0..2, lat, lon, elevFt, runways] */
export type AirportRec = [string, string, string, string, number, number, number, number, RunwayRec[]];
/** [leIdent, heIdent, leLat|null, leLon|null, heLat|null, heLon|null, lengthFt, widthFt, surface 0..2, headingTrue] */
export type RunwayRec = [string, string, number | null, number | null, number | null, number | null, number, number, number, number];

export interface AirportHit {
  ident: string;
  name: string;
  place: string;
  country: string;
  size: number;
  rec: AirportRec;
}

export class AirportDb {
  private byIdent = new Map<string, AirportRec>();

  constructor(readonly list: AirportRec[]) {
    for (const a of list) this.byIdent.set(a[0].toUpperCase(), a);
  }

  get(ident: string): AirportRec | undefined {
    return this.byIdent.get(ident.toUpperCase());
  }

  /** Search by code, name or town. Exact codes first, then bigger airports, then name order. */
  search(query: string, limit = 30): AirportHit[] {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const words = q.split(/\s+/);
    const scored: [number, AirportRec][] = [];
    for (const a of this.list) {
      const ident = a[0].toLowerCase();
      const hay = `${ident} ${a[1].toLowerCase()} ${a[2].toLowerCase()} ${a[3].toLowerCase()}`;
      if (!words.every((w) => hay.includes(w))) continue;
      let score = (2 - a[4]) * 10;
      if (ident === q) score -= 100;
      else if (ident.startsWith(q)) score -= 40;
      if (a[1].toLowerCase().startsWith(q) || a[2].toLowerCase().startsWith(q)) score -= 15;
      scored.push([score, a]);
    }
    scored.sort((x, y) => x[0] - y[0] || x[1][1].localeCompare(y[1][1]));
    return scored.slice(0, limit).map(([, rec]) => ({ ident: rec[0], name: rec[1], place: rec[2], country: rec[3], size: rec[4], rec }));
  }

  /** Airports within `radius` metres of a point, nearest first (at most `limit`). */
  near(p: LatLon, radius: number, limit: number): AirportRec[] {
    const dLat = radius / 111000;
    const out: [number, AirportRec][] = [];
    for (const a of this.list) {
      if (Math.abs(a[5] - p.lat) > dLat) continue;
      const d = distanceM(p, { lat: a[5], lon: a[6] });
      if (d <= radius) out.push([d, a]);
    }
    out.sort((x, y) => x[0] - y[0]);
    return out.slice(0, limit).map(([, a]) => a);
  }
}

let loading: Promise<AirportDb> | null = null;

/** Load the airport file once (about 1.4 MB compressed). */
export function loadAirportDb(): Promise<AirportDb> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/airports.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`airports.json: HTTP ${r.status}`);
      return r.json() as Promise<{ v: number; a: AirportRec[] }>;
    })
    .then((d) => new AirportDb(d.a))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}
