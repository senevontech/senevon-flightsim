/* Trees, palms and houses near the camera, generated per 1 km tile from the region's masks.
   Each kind is ONE InstancedMesh; tiles own fixed blocks of instance slots, so streaming tiles
   in and out costs no extra draw calls (mobile budget). Far away, forests are carried by the
   terrain's vertex colours instead. */
import {
  BufferGeometry, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DynamicDrawUsage, Float32BufferAttribute,
  IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector3, BoxGeometry,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "./textures";
import type { CoralCoast } from "../world/procedural/coralCoast";

const TILE = 1000;
const RADIUS = 6500;
const MAX_TILES = 150;

type KindName = "tree" | "palm" | "house" | "block";

interface Kind {
  mesh: InstancedMesh;
  perTile: number;
}

/** Give a geometry a flat vertex colour. `uv`: keep the UVs (textured), or pin them to a plain
    corner of the texture so this part shows no texture detail (roofs, trunks). */
function tinted(geo: BufferGeometry, hex: string, uv: "keep" | "plain" = "plain"): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new Color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new Float32BufferAttribute(arr, 3));
  if (uv === "plain") g.setAttribute("uv", new Float32BufferAttribute(new Float32Array(n * 2).fill(0.005), 2));
  return g;
}

/** Facade textures: window grids on a light wall; pixel (0,0) stays plain wall for untextured parts. */
function facadeTexture(cols: number, rows: number, kind: "block" | "house"): Texture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);
  const cw = S / cols, rh = S / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (kind === "house" && j === rows - 1 && i === 0) {
        g.fillStyle = "#6b4a34"; // door
        g.fillRect(i * cw + cw * 0.3, j * rh + rh * 0.25, cw * 0.4, rh * 0.75);
        continue;
      }
      const lit = (i * 7 + j * 13) % 9 === 0;
      g.fillStyle = lit ? "#e9d9a8" : kind === "block" ? "#3d4b5a" : "#45535f";
      const mx = kind === "block" ? 0.14 : 0.28, my = kind === "block" ? 0.2 : 0.3;
      g.fillRect(i * cw + cw * mx, j * rh + rh * my, cw * (1 - 2 * mx), rh * (1 - 2 * my));
    }
  }
  if (kind === "block") {
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let j = 0; j <= rows; j++) g.fillRect(0, j * rh - 1, S, 2); // floor slabs
  }
  g.fillStyle = "#ffffff";
  g.fillRect(0, S - 4, 4, 4); // canvas bottom-left = uv (0,0): plain wall
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function broadleafGeometry(): BufferGeometry {
  const trunk = tinted(new CylinderGeometry(0.05, 0.08, 0.5, 6).translate(0, 0.25, 0), "#5a4330");
  // a clumped crown of three overlapping blobs reads as foliage, not a lollipop
  const parts = [
    new IcosahedronGeometry(0.34, 1).scale(1, 0.85, 1).translate(0, 0.66, 0),
    new IcosahedronGeometry(0.26, 1).translate(0.2, 0.56, 0.08),
    new IcosahedronGeometry(0.24, 1).translate(-0.16, 0.58, -0.14),
  ].map((p) => tinted(p, "#ffffff"));
  return mergeGeometries([trunk, ...parts])!;
}

function palmGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  parts.push(tinted(new CylinderGeometry(0.035, 0.06, 1, 5).translate(0, 0.5, 0).rotateZ(0.12), "#7a6248"));
  for (let k = 0; k < 6; k++) {
    // drooping fronds: flattened cones pointing outward
    const frond = new ConeGeometry(0.09, 0.62, 3).rotateZ(Math.PI / 2 + 0.5).translate(0.3, 0.92, 0).rotateY((k / 6) * Math.PI * 2);
    parts.push(tinted(frond, "#ffffff"));
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

function blockGeometry(): BufferGeometry {
  // flat-roofed block (window grid on the walls) with a darker roof parapet
  const body = tinted(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), "#ffffff", "keep");
  const roof = tinted(new BoxGeometry(1.02, 0.03, 1.02).translate(0, 1.0, 0), "#6d7177");
  return mergeGeometries([body, roof])!;
}

function houseGeometry(): BufferGeometry {
  const walls = tinted(new BoxGeometry(1, 0.6, 1).translate(0, 0.3, 0), "#ffffff", "keep");
  const roof = tinted(new ConeGeometry(0.78, 0.4, 4).rotateY(Math.PI / 4).translate(0, 0.8, 0), "#b4583a");
  return mergeGeometries([walls, roof])!;
}

export class Scatter {
  private kinds: Record<KindName, Kind>;
  private tiles = new Map<string, number>(); // key → slot
  private freeSlots: number[] = [];
  private queue: string[] = [];
  private lastPlan = -1;
  private zero = new Matrix4().makeScale(0, 0, 0);

  constructor(private region: CoralCoast, quality: "low" | "high") {
    const foliage = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const palms = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    const blocks = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, map: facadeTexture(4, 8, "block") });
    const houses = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: facadeTexture(3, 2, "house") });
    const mk = (geo: BufferGeometry, perTile: number, mat: MeshStandardMaterial): Kind => {
      const mesh = new InstancedMesh(geo, mat, perTile * MAX_TILES);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, this.zero);
      mesh.setColorAt(0, new Color(1, 1, 1)); // allocate instanceColor
      return { mesh, perTile };
    };
    const f = quality === "high" ? 1 : 0.5;
    this.kinds = {
      tree: mk(broadleafGeometry(), Math.round(320 * f), foliage),
      palm: mk(palmGeometry(), Math.round(90 * f), palms),
      house: mk(houseGeometry(), Math.round(70 * f), houses),
      block: mk(blockGeometry(), Math.round(30 * f), blocks),
    };
    for (let s = MAX_TILES - 1; s >= 0; s--) this.freeSlots.push(s);
  }

  get meshes(): InstancedMesh[] {
    return Object.values(this.kinds).map((k) => k.mesh);
  }

  update(cam: Vector3, now: number): void {
    // re-plan which tiles are wanted a few times a second; build at most one tile per frame
    if (now - this.lastPlan > 250) {
      this.lastPlan = now;
      const wanted = new Set<string>();
      const ti = Math.floor(cam.x / TILE), tj = Math.floor(cam.z / TILE);
      const r = Math.ceil(RADIUS / TILE);
      const radius = cam.y > 3000 ? 0 : RADIUS; // nothing to see from very high up
      const list: [string, number][] = [];
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          const cx = (ti + i + 0.5) * TILE, cz = (tj + j + 0.5) * TILE;
          const d = Math.hypot(cx - cam.x, cz - cam.z);
          if (d > radius) continue;
          const key = `${ti + i}:${tj + j}`;
          wanted.add(key);
          list.push([key, d]);
        }
      }
      for (const [key, slot] of this.tiles) {
        if (!wanted.has(key)) {
          this.clearSlot(slot);
          this.tiles.delete(key);
          this.freeSlots.push(slot);
        }
      }
      list.sort((a, b) => a[1] - b[1]);
      this.queue = list.map(([k]) => k).filter((k) => !this.tiles.has(k));
    }
    const key = this.queue.shift();
    if (key && this.freeSlots.length) {
      const slot = this.freeSlots.pop()!;
      this.tiles.set(key, slot);
      const [i, j] = key.split(":").map(Number);
      this.buildTile(i, j, slot);
    }
  }

  private clearSlot(slot: number): void {
    for (const k of Object.values(this.kinds)) {
      const start = slot * k.perTile;
      for (let n = 0; n < k.perTile; n++) k.mesh.setMatrixAt(start + n, this.zero);
      k.mesh.instanceMatrix.addUpdateRange(start * 16, k.perTile * 16);
      k.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private buildTile(i: number, j: number, slot: number): void {
    const reg = this.region;
    const r = rng((i * 73856093) ^ (j * 19349663) ^ 0x5bd1e995);
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3();
    const up = new Vector3(0, 1, 0);
    const col = new Color();
    const count: Record<KindName, number> = { tree: 0, palm: 0, house: 0, block: 0 };
    const put = (kind: KindName, x: number, y: number, z: number, scale: Vector3, rot: number, color: Color) => {
      const k = this.kinds[kind];
      if (count[kind] >= k.perTile) return;
      const idx = slot * k.perTile + count[kind]++;
      q.setFromAxisAngle(up, rot);
      k.mesh.setMatrixAt(idx, m.compose(p.set(x, y, z), q, scale));
      k.mesh.setColorAt(idx, color);
    };
    const candidates = 700;
    for (let c = 0; c < candidates; c++) {
      const x = (i + r()) * TILE, z = (j + r()) * TILE;
      const roll = r(), rot = r() * Math.PI * 2, size = r();
      const h = reg.height(x, z);
      if (h < 1.2) continue;
      if (reg.airportZone(x, z) > 0.05) continue;
      // coast: palms
      if (h < 14 && roll < 0.22 * (1 - h / 14)) {
        const hgt = 9 + size * 7;
        put("palm", x, h - 0.3, z, s.set(hgt, hgt, hgt), rot, col.setHSL(0.26 + size * 0.05, 0.45, 0.3, SRGBColorSpace));
        continue;
      }
      const town = reg.town(x, z, h);
      if (town > 0.75 && roll < (town - 0.75) * 1.2) {
        // town centre: taller blocks on a street grid
        const w = 14 + size * 16, l = 14 + r() * 16, hh = 10 + Math.pow(r(), 2) * 32;
        put("block", x, h - 0.3, z, s.set(w, hh, l), (i % 3) * 0.3,
          col.set(["#d9d4cb", "#c4c9cf", "#e3dccd", "#b7b3ab", "#cfd8dd"][Math.floor(r() * 5)]));
        continue;
      }
      if (town > 0 && roll < town * 0.45) {
        const w = 8 + size * 7, l = 9 + r() * 9, hh = 5 + r() * 4;
        const rotGrid = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2) + (i % 3) * 0.3;
        put("house", x, h - 0.2, z, s.set(w, hh / 0.8, l), rotGrid,
          col.set(r() > 0.3 ? "#efe7d8" : r() > 0.5 ? "#d9c7a6" : "#f2d0b0"));
        continue;
      }
      const f = reg.forest(x, z, h);
      if (roll < f * 0.9 + 0.02) {
        const hgt = 11 + size * 13;
        put("tree", x, h - 0.4, z, s.set(hgt * 0.9, hgt, hgt * 0.9), rot, col.setHSL(0.24 + size * 0.08, 0.35 + r() * 0.2, 0.17 + r() * 0.09, SRGBColorSpace));
      }
    }
    for (const [name, k] of Object.entries(this.kinds) as [KindName, Kind][]) {
      const start = slot * k.perTile;
      for (let n = count[name]; n < k.perTile; n++) k.mesh.setMatrixAt(start + n, this.zero);
      k.mesh.instanceMatrix.addUpdateRange(start * 16, k.perTile * 16);
      k.mesh.instanceMatrix.needsUpdate = true;
      if (k.mesh.instanceColor) {
        k.mesh.instanceColor.addUpdateRange(start * 3, k.perTile * 3);
        k.mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
