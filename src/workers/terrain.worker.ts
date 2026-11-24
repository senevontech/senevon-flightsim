/* Builds one terrain chunk: (res+1)² grid + skirt ring. Positions are local to the chunk centre
   (precision), normals come from the height grid, colours from the region's biome rules. */
import { CoralCoast } from "../world/procedural/coralCoast";

export interface MapRequest {
  kind: "map";
  id: number;
  /** Pixels per side. */
  size: number;
  /** World metres covered per side (centred on 0,0). */
  extent: number;
}

export interface MapResult {
  kind: "map";
  id: number;
  size: number;
  pixels: Uint8ClampedArray;
}

export interface ChunkRequest {
  kind?: "chunk";
  id: number;
  cx: number;
  cz: number;
  size: number;
  res: number;
}

export interface ChunkResult {
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  minY: number;
  maxY: number;
}

const region = new CoralCoast();
const DETAIL_UV = 1 / 48; // detail texture repeats every 48 m

function buildMap(req: MapRequest): void {
  const { size, extent } = req;
  const px = new Uint8ClampedArray(size * size * 4);
  const step = extent / size;
  const hs = new Float32Array((size + 1) * (size + 1));
  for (let j = 0; j <= size; j++) {
    for (let i = 0; i <= size; i++) hs[j * (size + 1) + i] = region.height(-extent / 2 + i * step, -extent / 2 + j * step);
  }
  const col = new Float32Array(3);
  const toSrgb = (v: number) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = hs[j * (size + 1) + i];
      const x = -extent / 2 + i * step, z = -extent / 2 + j * step;
      region.color(x, z, h, 1, col, 0);
      // hill shading from the north-west
      const dx = hs[j * (size + 1) + i + 1] - h, dz = hs[(j + 1) * (size + 1) + i] - h;
      const shade = h > 0 ? Math.max(0.55, Math.min(1.35, 1 - (dx + dz) / step * 1.6)) : 1;
      const k = (j * size + i) * 4;
      px[k] = toSrgb(col[0] * shade);
      px[k + 1] = toSrgb(col[1] * shade);
      px[k + 2] = toSrgb(col[2] * shade);
      px[k + 3] = 255;
    }
  }
  const out: MapResult = { kind: "map", id: req.id, size, pixels: px };
  (self as unknown as Worker).postMessage(out, [px.buffer]);
}

self.onmessage = (e: MessageEvent<ChunkRequest | MapRequest>) => {
  if (e.data.kind === "map") return buildMap(e.data);
  const { id, cx, cz, size, res } = e.data;
  const step = size / res;
  const x0 = cx - size / 2, z0 = cz - size / 2;
  const g = res + 3; // grid with a 1-cell border for normals
  const hs = new Float32Array(g * g);
  for (let j = 0; j < g; j++) {
    for (let i = 0; i < g; i++) hs[j * g + i] = region.height(x0 + (i - 1) * step, z0 + (j - 1) * step);
  }
  const n = res + 1;
  const skirt = 4 * n;
  const count = n * n + skirt;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  let minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const gi = (j + 1) * g + (i + 1);
      const h = hs[gi];
      const x = x0 + i * step, z = z0 + j * step;
      positions[k * 3] = x - cx;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z - cz;
      let nx = hs[gi - 1] - hs[gi + 1], nz = hs[gi - g] - hs[gi + g];
      const ny = 2 * step;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; nz /= l;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny / l;
      normals[k * 3 + 2] = nz;
      region.color(x, z, h, ny / l, colors, k * 3);
      uvs[k * 2] = x * DETAIL_UV;
      uvs[k * 2 + 1] = z * DETAIL_UV;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }
  // skirt: copy each edge vertex, dropped down, to hide cracks between LOD levels
  const drop = step * 1.5 + 6;
  const edge: number[] = [];
  for (let i = 0; i < n; i++) edge.push(i); // top row (j = 0)
  for (let j = 0; j < n; j++) edge.push(j * n + res); // right column
  for (let i = res; i >= 0; i--) edge.push(res * n + i); // bottom row
  for (let j = res; j >= 0; j--) edge.push(j * n); // left column
  edge.forEach((src, e2) => {
    const k = n * n + e2;
    positions.copyWithin(k * 3, src * 3, src * 3 + 3);
    positions[k * 3 + 1] -= drop;
    normals.copyWithin(k * 3, src * 3, src * 3 + 3);
    colors.copyWithin(k * 3, src * 3, src * 3 + 3);
    uvs.copyWithin(k * 2, src * 2, src * 2 + 2);
  });
  const result: ChunkResult = { id, positions, normals, colors, uvs, minY: minY - drop, maxY };
  (self as unknown as Worker).postMessage(result, [positions.buffer, normals.buffer, colors.buffer, uvs.buffer]);
};
