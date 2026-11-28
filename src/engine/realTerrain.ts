/* Terrain for the real-world mode: a quadtree of Web Mercator tiles around the camera, each a
   mesh shaped by the elevation data (RealWorld.terrainHeight, so runway sites are flat) and
   draped with satellite imagery:

     Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel
     data 2016 & 2017), CC BY 4.0 — https://s2maps.eu  (credit shown on screen, docs/ASSETS.md)

   Detail rises toward the camera (down to zoom 15 near it on High, 14 on Low). Imagery tops out
   at zoom 12 (≈ 38 m a pixel at the equator, ~26 m in mid-latitudes). The public imagery server
   renders tiles nobody has asked for yet on demand, which can take 20–50 s (zoom 14 even more),
   so imagery is progressive: a chunk is built
   as soon as its elevation and ANY coarser image are in (zoom ≤ 10 base tiles have their own
   download slots and arrive in ~1–4 s), then re-draped whenever a sharper image arrives. Images
   are decoded off the main thread (createImageBitmap). Same rules as the procedural terrain: a chunk is
   replaced only once everything covering its area is ready, so there are no holes; skirts hide
   cracks between neighbours of different detail. */
import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, Texture, Vector3,
} from "three";
import type { RealWorld } from "../world/real/RealWorld";
import { DEM_MAX_Z } from "../world/real/dem";
import { tileKey, tileLatLon, tileSizeM, tileXY } from "../world/real/geo";

const N = 24; // grid segments per chunk side
const ROOT_Z = 8;
/** View radius and how eagerly detail rises (Low: phones' draw-call budget). */
const VIEW = { high: { radius: 160000, split: 1.6 }, low: { radius: 110000, split: 1.4 } };
/** The loading screen waits only for chunks this close; the rest stream in while flying. */
const LOAD_RADIUS = 12000;
const IMG_MAX_Z = 12;
/** Base imagery: requested for every chunk so it can be built quickly. */
const IMG_BASE_Z = 10;
const IMG_TIMEOUT_MS = 60000;
// browsers open ~6 connections per server (HTTP/1.1): base tiles first, detail never takes them all
const MAX_IN_FLIGHT = 6;
const DETAIL_SLOTS = 5;
const BUILDS_PER_FRAME = 3;
export const imageryUrl = (z: number, x: number, y: number) =>
  `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`;

/** The Sentinel-2 mosaic is dark and teal-tinted (a forest averages sRGB 24/43/38). Lift it to
    ground-like albedos: a gamma lift (dark tones gain the most) and a warmer balance. One shared
    shader program for every chunk. */
function liftImagery(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `#include <map_fragment>
     diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(0.72)) * vec3(1.95, 1.45, 1.0);`,
  );
}

interface Chunk {
  key: string;
  z: number;
  x: number;
  y: number;
  mesh: Mesh | null;
  imgKey: string | null;
  /** Zoom of the imagery draped on it now (−1 none). */
  imgZ: number;
  /** Tile coordinates of every vertex (grid, then skirts), to re-drape without rebuilding. */
  mxy: Float32Array | null;
}

interface Img {
  tex: Texture | null;
  state: "queued" | "loading" | "ok" | "failed";
  refs: number;
  pri: number;
  z: number;
  x: number;
  y: number;
  /** Last plan that asked for it (unused tiles are dropped a few plans later). */
  seen: number;
}

export class RealTerrain {
  readonly group = new Group();
  private chunks = new Map<string, Chunk>();
  private wanted = new Map<string, Chunk>();
  private imgs = new Map<string, Img>();
  private baseLoading = 0;
  private detailLoading = 0;
  private lastRefine = 0;
  private lastPlan = -Infinity;
  private planNo = 0;
  private maxZ: number;
  private radius: number;
  private split: number;
  private tint = new Color(1, 1, 1);

  constructor(private world: RealWorld, quality: "low" | "high") {
    this.maxZ = quality === "high" ? 15 : 14;
    this.radius = VIEW[quality].radius;
    this.split = VIEW[quality].split;
  }

  private cam = new Vector3();

  /** Wanted chunks near the camera not built yet (the loading screen waits for these). */
  get pending(): number {
    let n = 0;
    for (const c of this.wanted.values()) if (!c.mesh && this.dist(c, this.cam) < LOAD_RADIUS) n++;
    return n;
  }

  update(cam: Vector3, now: number): void {
    this.cam.copy(cam);
    if (now - this.lastPlan > 200) {
      this.lastPlan = now;
      this.plan(cam);
    }
    // build the nearest chunks whose data has arrived
    let built = 0;
    const ready = [...this.wanted.values()].filter((c) => !c.mesh && this.dataReady(c));
    ready.sort((a, b) => this.dist(a, cam) - this.dist(b, cam));
    for (const c of ready) {
      if (built++ >= BUILDS_PER_FRAME) break;
      this.build(c);
    }
    if (built) this.retire();
    if (now - this.lastRefine > 250) {
      this.lastRefine = now;
      this.refine();
    }
    this.pumpImagery();
  }

  /** Swap in sharper imagery on built chunks whose better tile has arrived. */
  private refine(): void {
    for (const c of this.wanted.values()) {
      if (!c.mesh || c.imgZ >= Math.min(c.z, IMG_MAX_Z)) continue;
      const best = this.imageryFor(c);
      if (!best || best.z <= c.imgZ) continue;
      this.drape(c, best);
    }
  }

  // ---------- planning ----------
  private plan(cam: Vector3): void {
    this.planNo++;
    const ll = this.world.frame.toLatLon(cam.x, cam.z);
    const next = new Map<string, Chunk>();
    const t = tileXY(ll.lat, ll.lon, ROOT_Z);
    const rootTiles = Math.ceil(this.radius / tileSizeM(ROOT_Z, ll.lat)) + 1;
    const n = 2 ** ROOT_Z;
    for (let j = -rootTiles; j <= rootTiles; j++) {
      for (let i = -rootTiles; i <= rootTiles; i++) {
        const x = Math.floor(t.x) + i, y = Math.floor(t.y) + j;
        if (y < 0 || y >= n) continue;
        this.visit(ROOT_Z, ((x % n) + n) % n, y, cam, ll.lat, next);
      }
    }
    for (const c of next.values()) {
      if (!this.chunks.has(c.key)) this.chunks.set(c.key, c);
      this.requestData(c, this.dist(c, cam));
    }
    this.wanted = new Map([...next.keys()].map((k) => [k, this.chunks.get(k)!]));
    this.retire();
    // imagery nobody uses or asks for any more (e.g. the camera moved on before it was draped)
    for (const [key, img] of this.imgs) {
      if (img.refs > 0 || img.state === "loading" || this.planNo - img.seen < 5) continue;
      img.tex?.dispose();
      (img.tex?.image as ImageBitmap | null)?.close?.();
      this.imgs.delete(key);
    }
  }

  private visit(z: number, x: number, y: number, cam: Vector3, lat: number, out: Map<string, Chunk>): void {
    const centre = this.tileCentre(z, x, y);
    const size = tileSizeM(z, lat);
    const d = Math.max(0, Math.hypot(centre.x - cam.x, centre.z - cam.z) - size * 0.7);
    if (z === ROOT_Z && d > this.radius) return;
    const dd = Math.hypot(d, Math.max(0, cam.y - 300) * 0.8);
    if (z < this.maxZ && dd < size * this.split) {
      for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) this.visit(z + 1, x * 2 + cx, y * 2 + cy, cam, lat, out);
      return;
    }
    const key = tileKey(z, x, y);
    out.set(key, this.chunks.get(key) ?? { key, z, x, y, mesh: null, imgKey: null, imgZ: -1, mxy: null });
  }

  private tileCentre(z: number, x: number, y: number): { x: number; z: number } {
    const ll = tileLatLon(x + 0.5, y + 0.5, z);
    return this.world.frame.toWorld(ll.lat, ll.lon);
  }

  private dist(c: Chunk, cam: Vector3): number {
    const p = this.tileCentre(c.z, c.x, c.y);
    return Math.hypot(p.x - cam.x, p.z - cam.z);
  }

  // ---------- data ----------
  /** Elevation tile for a chunk: two zooms coarser still gives 64 data pixels across its 24-cell
      grid, and one elevation tile then serves 16 chunks (far fewer downloads). */
  private demTile(c: Chunk): [number, number, number] {
    const z = Math.min(DEM_MAX_Z, Math.max(5, c.z - 2)), s = c.z - z;
    return [z, c.x >> s, c.y >> s];
  }

  private requestData(c: Chunk, dist: number): void {
    const pri = dist / 1000;
    if (!c.mesh) {
      const [dz, dx, dy] = this.demTile(c);
      this.world.dem.request(dz, dx, dy, pri);
    }
    const zi = Math.min(c.z, IMG_MAX_Z);
    if (c.imgZ < zi) this.requestImg(zi, c.x >> (c.z - zi), c.y >> (c.z - zi), pri);
    const zb = Math.min(c.z, IMG_BASE_Z);
    this.requestImg(zb, c.x >> (c.z - zb), c.y >> (c.z - zb), pri);
  }

  /** The sharpest imagery loaded so far for a chunk (its own zoom or an ancestor), or null. */
  private imageryFor(c: Chunk): { key: string; img: Img; z: number; x: number; y: number } | null {
    for (let z = Math.min(c.z, IMG_MAX_Z); z >= 0; z--) {
      const s = c.z - z, x = c.x >> s, y = c.y >> s;
      const key = tileKey(z, x, y);
      const img = this.imgs.get(key);
      if (img?.state === "ok") return { key, img, z, x, y };
    }
    return null;
  }

  /** Base imagery can't arrive (offline / server down): build plain-coloured chunks instead. */
  private baseFailed(c: Chunk): boolean {
    const zb = Math.min(c.z, IMG_BASE_Z);
    return this.imgs.get(tileKey(zb, c.x >> (c.z - zb), c.y >> (c.z - zb)))?.state === "failed";
  }

  private dataReady(c: Chunk): boolean {
    const [dz, dx, dy] = this.demTile(c);
    if (!this.world.dem.settled(dz, dx, dy)) return false;
    return this.imageryFor(c) !== null || this.baseFailed(c);
  }

  private requestImg(z: number, x: number, y: number, pri: number): void {
    const key = tileKey(z, x, y);
    const img = this.imgs.get(key);
    if (img) { img.pri = img.seen === this.planNo ? Math.min(img.pri, pri) : pri; img.seen = this.planNo; return; }
    this.imgs.set(key, { tex: null, state: "queued", refs: 0, pri, z, x, y, seen: this.planNo });
  }

  /** Nearest tiles first; slow detail downloads never take every connection. */
  private pumpImagery(): void {
    if (this.baseLoading + this.detailLoading >= MAX_IN_FLIGHT) return;
    // nearest first; a base tile counts as half as far (it lets a chunk be built at all)
    const rank = (i: Img) => (i.z <= IMG_BASE_Z ? i.pri * 0.5 : i.pri);
    const queued = [...this.imgs.values()].filter((i) => i.state === "queued").sort((a, b) => rank(a) - rank(b));
    for (const img of queued) {
      if (this.baseLoading + this.detailLoading >= MAX_IN_FLIGHT) break;
      const base = img.z <= IMG_BASE_Z;
      if (!base && this.detailLoading >= DETAIL_SLOTS) continue;
      img.state = "loading";
      if (base) this.baseLoading++;
      else this.detailLoading++;
      void this.loadImage(img);
    }
  }

  private async loadImage(img: Img): Promise<void> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IMG_TIMEOUT_MS);
    try {
      const res = await fetch(imageryUrl(img.z, img.x, img.y), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // flipped here because WebGL ignores flipY for ImageBitmaps (the UVs expect v = 1 at the top)
      const bmp = await createImageBitmap(await res.blob(), { imageOrientation: "flipY" });
      if (!this.imgs.has(tileKey(img.z, img.x, img.y))) { bmp.close(); return; }
      const tex = new Texture(bmp);
      tex.flipY = false;
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      img.tex = tex;
      img.state = "ok";
    } catch {
      img.state = "failed";
    } finally {
      clearTimeout(timer);
      if (img.z <= IMG_BASE_Z) this.baseLoading--;
      else this.detailLoading--;
    }
  }

  // ---------- meshes ----------
  private build(c: Chunk): void {
    const imagery = this.imageryFor(c);
    const [dz] = this.demTile(c);
    const frame = this.world.frame;
    const V = N + 1;
    const skirt = 4 * V;
    const pos = new Float32Array((V * V + skirt) * 3);
    const uv = new Float32Array((V * V + skirt) * 2);
    const mxy = new Float32Array((V * V + skirt) * 2);
    const ll = { lat: 0, lon: 0 }, w = { x: 0, z: 0 };
    let minY = Infinity;
    const put = (k: number, i: number, j: number, drop: number) => {
      const mx = c.x + i / N, my = c.y + j / N;
      tileLatLon(mx, my, c.z, ll);
      frame.toWorld(ll.lat, ll.lon, w);
      const h = this.world.terrainHeight(w.x, w.z, dz);
      minY = Math.min(minY, h);
      pos[k * 3] = w.x;
      pos[k * 3 + 1] = h - drop;
      pos[k * 3 + 2] = w.z;
      mxy[k * 2] = i / N;
      mxy[k * 2 + 1] = j / N;
    };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) put(j * V + i, i, j, 0);
    // skirts: a copy of each edge, dropped, stitched to the edge
    const drop = Math.max(15, tileSizeM(c.z, ll.lat) * 0.015);
    const edges: [number, number][][] = [
      Array.from({ length: V }, (_, i) => [i, 0]), Array.from({ length: V }, (_, i) => [N, i]),
      Array.from({ length: V }, (_, i) => [N - i, N]), Array.from({ length: V }, (_, i) => [0, N - i]),
    ];
    const idx: number[] = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * V + i, b = a + 1, d = a + V, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    let k = V * V;
    for (const edge of edges) {
      const start = k;
      for (const [i, j] of edge) put(k++, i, j, drop);
      for (let s = 0; s < N; s++) {
        const top0 = edge[s][1] * V + edge[s][0], top1 = edge[s + 1][1] * V + edge[s + 1][0];
        const bot0 = start + s, bot1 = start + s + 1;
        idx.push(top0, bot0, top1, top1, bot0, bot1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("uv", new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new MeshStandardMaterial({ roughness: 1, metalness: 0, color: this.tint });
    mat.onBeforeCompile = liftImagery;
    mat.customProgramCacheKey = () => "realTerrain";
    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    c.mesh = mesh;
    c.mxy = mxy;
    if (imagery) this.drape(c, imagery);
    else mat.color.set("#5d7a46");
    this.group.add(mesh);
  }

  /** Put an imagery tile (the chunk's own zoom or an ancestor) on a built chunk. */
  private drape(c: Chunk, im: { key: string; img: Img; z: number; x: number; y: number }): void {
    const mesh = c.mesh!, mxy = c.mxy!;
    const uvAttr = mesh.geometry.getAttribute("uv") as BufferAttribute;
    const uv = uvAttr.array as Float32Array;
    const scale = 2 ** (im.z - c.z);
    for (let k = 0; k < mxy.length / 2; k++) {
      uv[k * 2] = (c.x + mxy[k * 2]) * scale - im.x;
      uv[k * 2 + 1] = 1 - ((c.y + mxy[k * 2 + 1]) * scale - im.y);
    }
    uvAttr.needsUpdate = true;
    this.releaseImg(c);
    const mat = mesh.material as MeshStandardMaterial;
    mat.map = im.img.tex;
    mat.color.copy(this.tint);
    mat.needsUpdate = true;
    im.img.refs++;
    c.imgKey = im.key;
    c.imgZ = im.z;
  }

  private releaseImg(c: Chunk): void {
    if (!c.imgKey) return;
    const img = this.imgs.get(c.imgKey);
    if (img && --img.refs <= 0 && img.tex) {
      img.tex.dispose();
      (img.tex.image as ImageBitmap | null)?.close?.();
      this.imgs.delete(c.imgKey);
    }
    c.imgKey = null;
    c.imgZ = -1;
  }

  /** Remove chunks that are no longer wanted once every wanted chunk over their area is built. */
  private retire(): void {
    const wanted = [...this.wanted.values()];
    for (const c of [...this.chunks.values()]) {
      if (this.wanted.has(c.key)) continue;
      if (!c.mesh) { this.chunks.delete(c.key); continue; }
      const covered = wanted.every((w) => !overlaps(w, c) || !!w.mesh);
      if (covered) this.remove(c);
    }
  }

  private remove(c: Chunk): void {
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      (c.mesh.material as MeshStandardMaterial).dispose();
      c.mesh = null;
    }
    this.releaseImg(c);
    c.mxy = null;
    this.chunks.delete(c.key);
  }
}

/** Do two tiles (any zooms) cover overlapping ground? */
function overlaps(a: Chunk, b: Chunk): boolean {
  const z = Math.min(a.z, b.z);
  return a.x >> (a.z - z) === b.x >> (b.z - z) && a.y >> (a.z - z) === b.y >> (b.z - z);
}
