/* Elevation for the real-world mode: AWS Terrain Tiles (Terrarium encoding, open data; SRTM,
   USGS, ETOPO and others — see docs/ASSETS.md for the credit), in Web Mercator tiles.

   Tiles are fetched and decoded by a worker (dem.worker.ts) and kept as Uint16 at 0.25 m steps
   from −500 m (131 KB a tile instead of 262 KB as floats), in an LRU cache. sample() reads the
   most detailed tile that is loaded for a point, so heights sharpen as tiles arrive and never
   go missing once a coarse tile is in. */
import { tileKey, tileXY } from "./geo";

export const DEM_MAX_Z = 13; // ~15 m a pixel at the equator, finer than the ~30 m source data
export const demUrl = (z: number, x: number, y: number) =>
  `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;

const SIZE = 256;
const MAX_TILES = 260; // ~34 MB
const IN_FLIGHT = 6;

export const packHeight = (h: number) => Math.max(0, Math.min(65535, Math.round((h + 500) * 4)));
export const unpackHeight = (v: number) => v / 4 - 500;

interface Tile {
  data: Uint16Array;
  used: number;
}

/** Something that turns a tile request into decoded heights (a worker in the browser, a stub in tests). */
export type DemFetcher = (z: number, x: number, y: number) => Promise<Uint16Array>;

export class DemCache {
  private tiles = new Map<string, Tile>();
  private pending = new Set<string>();
  private failed = new Set<string>();
  private queue: { z: number; x: number; y: number; key: string; pri: number }[] = [];
  private inFlight = 0;
  private clock = 0;
  /** Called when a tile arrives (the terrain rebuilds chunks that were waiting for it). */
  onTile: ((z: number, x: number, y: number) => void) | null = null;

  constructor(private fetcher: DemFetcher = workerFetcher()) {}

  has(z: number, x: number, y: number): boolean {
    return this.tiles.has(tileKey(z, x, y));
  }

  /** True when the tile is loaded or can never load (failed / outside the data). */
  settled(z: number, x: number, y: number): boolean {
    const k = tileKey(z, x, y);
    return this.tiles.has(k) || this.failed.has(k);
  }

  get busy(): number {
    return this.inFlight + this.queue.length;
  }

  /** Ask for a tile; lower `pri` loads first. */
  request(z: number, x: number, y: number, pri = 0): void {
    const n = 2 ** z;
    if (y < 0 || y >= n) return;
    x = ((x % n) + n) % n;
    const key = tileKey(z, x, y);
    if (this.tiles.has(key) || this.pending.has(key) || this.failed.has(key)) return;
    const q = this.queue.find((e) => e.key === key);
    if (q) { q.pri = Math.min(q.pri, pri); return; }
    this.queue.push({ z, x, y, key, pri });
    this.pump();
  }

  /** Put decoded heights in directly (tests, or a preloaded tile). */
  put(z: number, x: number, y: number, data: Uint16Array): void {
    this.tiles.set(tileKey(z, x, y), { data, used: ++this.clock });
    this.evict();
  }

  /** Height (m) at a point from the most detailed loaded tile at or below `zMax`, or null. */
  sample(lat: number, lon: number, zMax = DEM_MAX_Z): number | null {
    for (let z = zMax; z >= 0; z--) {
      const t = tileXY(lat, lon, z);
      const n = 2 ** z;
      const tx = Math.floor(t.x), ty = Math.floor(t.y);
      const tile = this.tiles.get(tileKey(z, ((tx % n) + n) % n, ty));
      if (!tile) continue;
      tile.used = ++this.clock;
      // bilinear between pixel centres (clamped at the tile edge)
      const fx = Math.min(SIZE - 1, Math.max(0, (t.x - tx) * SIZE - 0.5));
      const fy = Math.min(SIZE - 1, Math.max(0, (t.y - ty) * SIZE - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(SIZE - 1, x0 + 1), y1 = Math.min(SIZE - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const d = tile.data;
      const h00 = d[y0 * SIZE + x0], h10 = d[y0 * SIZE + x1], h01 = d[y1 * SIZE + x0], h11 = d[y1 * SIZE + x1];
      const v = (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
      return unpackHeight(v);
    }
    return null;
  }

  private pump(): void {
    while (this.inFlight < IN_FLIGHT && this.queue.length) {
      this.queue.sort((a, b) => a.pri - b.pri);
      const { z, x, y, key } = this.queue.shift()!;
      this.pending.add(key);
      this.inFlight++;
      this.fetcher(z, x, y).then(
        (data) => {
          this.put(z, x, y, data);
          this.onTile?.(z, x, y);
        },
        () => this.failed.add(key),
      ).finally(() => {
        this.pending.delete(key);
        this.inFlight--;
        this.pump();
      });
    }
  }

  private evict(): void {
    if (this.tiles.size <= MAX_TILES) return;
    // drop the least recently used detailed tiles; low zooms (< 9) are cheap and always useful
    const byAge = [...this.tiles.entries()].filter(([k]) => Number(k.split("/")[0]) >= 9).sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < byAge.length && this.tiles.size > MAX_TILES; i++) this.tiles.delete(byAge[i][0]);
  }
}

/** Two decoder workers in the browser; requests fail fast where workers don't exist (tests). */
function workerFetcher(): DemFetcher {
  if (typeof Worker === "undefined") return () => Promise.reject(new Error("no workers"));
  const workers: Worker[] = [];
  const waiting = new Map<number, { ok: (d: Uint16Array) => void; fail: (e: Error) => void }>();
  let next = 0, seq = 0;
  const get = () => {
    if (workers.length < 2) {
      const w = new Worker(new URL("../../workers/dem.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; data?: Uint16Array; error?: string }>) => {
        const h = waiting.get(e.data.id);
        if (!h) return;
        waiting.delete(e.data.id);
        if (e.data.data) h.ok(e.data.data);
        else h.fail(new Error(e.data.error ?? "failed"));
      };
      workers.push(w);
    }
    return workers[next++ % workers.length];
  };
  return (z, x, y) => new Promise((ok, fail) => {
    const id = ++seq;
    waiting.set(id, { ok, fail });
    get().postMessage({ id, url: demUrl(z, x, y) });
  });
}
