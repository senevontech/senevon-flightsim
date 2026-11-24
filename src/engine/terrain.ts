/* Streaming terrain: a quadtree of chunks around the camera (fine near, coarse far), built in
   Web Workers. A chunk that is no longer wanted stays visible until everything replacing it is
   ready, so the ground never shows holes while flying. */
import {
  Box3, BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Sphere, Vector3, type Texture,
} from "three";
import type { ChunkRequest, ChunkResult } from "../workers/terrain.worker";

const RES = 32;
const MIN_SIZE = 256;
const SPLIT = 1.7; // split a node when the camera is closer than SPLIT × its size

interface Node {
  key: string;
  cx: number;
  cz: number;
  size: number;
  mesh: Mesh | null;
  pending: boolean;
}

function buildIndex(res: number): BufferAttribute {
  const n = res + 1;
  const idx: number[] = [];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // skirt quads: edge ring vertex e ↔ skirt vertex n² + e
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(i);
  for (let j = 0; j < n; j++) ring.push(j * n + res);
  for (let i = res; i >= 0; i--) ring.push(res * n + i);
  for (let j = res; j >= 0; j--) ring.push(j * n);
  for (let e = 0; e < ring.length - 1; e++) {
    const a = ring[e], b = ring[e + 1], sa = n * n + e, sb = n * n + e + 1;
    idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb); // both windings (skirts seen from either side)
  }
  return new BufferAttribute(new Uint32Array(idx), 1);
}

export class Terrain {
  readonly group = new Group();
  readonly material: MeshStandardMaterial;
  private nodes = new Map<string, Node>();
  private byId = new Map<number, Node>();
  private queue: Node[] = [];
  private workers: { w: Worker; busy: boolean }[] = [];
  private index = buildIndex(RES);
  private nextId = 1;
  private lastUpdate = -1;
  /** Chunks requested but not built yet. */
  get pending(): number {
    let n = 0;
    for (const node of this.nodes.values()) if (node.pending) n++;
    return n;
  }

  constructor(private extent: number, detail: Texture, fields: Texture) {
    detail.repeat.set(1, 1);
    this.material = new MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.95, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.fieldsMap = { value: fields };
      sh.vertexShader = "varying float vWorldY;\n" + sh.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;",
      );
      sh.fragmentShader = "uniform sampler2D fieldsMap;\nvarying float vWorldY;\n" + sh.fragmentShader
        // colour: fine grain near the camera, medium patches, and large-scale variation everywhere
        .replace(
          "#include <map_fragment>",
          `float dist = length(vViewPosition);
           float nearFade = clamp(1.0 - dist / 1800.0, 0.0, 1.0);
           float midFade = clamp(1.0 - dist / 9000.0, 0.0, 1.0);
           float d1 = texture2D(map, vMapUv).r;
           float d2 = texture2D(map, vMapUv * 0.17).r;
           float d3 = texture2D(map, vMapUv * 0.021).r;
           float detailMul = mix(1.0, d1 * 1.75, nearFade * 0.7)
                             * mix(1.0, d2 * 1.75, midFade * 0.5)
                             * mix(1.0, d3 * 1.75, 0.4);`,
        )
        // after the vertex (biome) colour: farmland patchwork in green lowland districts, then detail
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           {
             vec3 fc = texture2D(fieldsMap, vMapUv * 0.024).rgb;
             float lowland = smoothstep(2.5, 7.0, vWorldY) * (1.0 - smoothstep(60.0, 130.0, vWorldY));
             float greenish = smoothstep(0.0, 0.03, diffuseColor.g - diffuseColor.r * 1.08);
             float district = smoothstep(0.5, 0.6, d3);
             diffuseColor.rgb = mix(diffuseColor.rgb, fc * 0.8, lowland * greenish * district * 0.75);
           }
           diffuseColor.rgb *= detailMul;`,
        )
        // fake relief: tilt the normal along the detail noise gradient (fades with distance)
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
           {
             float e = 1.0 / 256.0;
             vec2 uvA = vMapUv * 0.17;
             float hA = texture2D(map, uvA).r;
             vec2 gA = vec2(texture2D(map, uvA + vec2(e, 0.0)).r - hA, texture2D(map, uvA + vec2(0.0, e)).r - hA);
             float hB = texture2D(map, vMapUv).r;
             vec2 gB = vec2(texture2D(map, vMapUv + vec2(e, 0.0)).r - hB, texture2D(map, vMapUv + vec2(0.0, e)).r - hB);
             vec2 g = gA * 6.0 * midFade + gB * 3.0 * nearFade;
             normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
           }`,
        );
    };
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("../workers/terrain.worker.ts", import.meta.url), { type: "module" });
      const slot = { w, busy: false };
      w.onmessage = (e: MessageEvent<ChunkResult>) => {
        slot.busy = false;
        this.onChunk(e.data);
        this.pump();
      };
      this.workers.push(slot);
    }
  }

  /** Call every frame with the camera position. */
  update(cam: Vector3, now: number): void {
    if (now - this.lastUpdate < 120) return;
    this.lastUpdate = now;
    const wanted = new Map<string, Node>();
    const visit = (cx: number, cz: number, size: number) => {
      const dx = Math.max(0, Math.abs(cam.x - cx) - size / 2);
      const dz = Math.max(0, Math.abs(cam.z - cz) - size / 2);
      const d = Math.hypot(dx, dz, Math.max(0, cam.y - 50) * 0.7);
      if (size > MIN_SIZE && d < size * SPLIT) {
        const q = size / 4;
        visit(cx - q, cz - q, size / 2);
        visit(cx + q, cz - q, size / 2);
        visit(cx - q, cz + q, size / 2);
        visit(cx + q, cz + q, size / 2);
        return;
      }
      const key = `${size}:${cx}:${cz}`;
      let node = this.nodes.get(key);
      if (!node) {
        node = { key, cx, cz, size, mesh: null, pending: true };
        this.nodes.set(key, node);
        this.queue.push(node);
      }
      wanted.set(key, node);
    };
    visit(0, 0, this.extent);

    // retire nodes that are no longer wanted once their area is fully covered by ready nodes
    const wantedList = [...wanted.values()];
    for (const node of [...this.nodes.values()]) {
      if (wanted.has(node.key)) continue;
      if (node.pending) {
        // never built and no longer needed: drop it
        this.queue = this.queue.filter((q) => q !== node);
        this.nodes.delete(node.key);
        continue;
      }
      const covered = wantedList.every((w) => !overlaps(w, node) || !w.pending);
      if (covered) this.remove(node);
    }
    // nearest / biggest first
    this.queue.sort((a, b) => b.size - a.size || dist(a, cam) - dist(b, cam));
    this.pump();
  }

  private pump(): void {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const node = this.queue.shift();
      if (!node) return;
      const id = this.nextId++;
      this.byId.set(id, node);
      slot.busy = true;
      const req: ChunkRequest = { id, cx: node.cx, cz: node.cz, size: node.size, res: RES };
      slot.w.postMessage(req);
    }
  }

  private onChunk(r: ChunkResult): void {
    const node = this.byId.get(r.id);
    this.byId.delete(r.id);
    if (!node || this.nodes.get(node.key) !== node) return; // dropped meanwhile
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(r.positions, 3));
    geo.setAttribute("normal", new BufferAttribute(r.normals, 3));
    geo.setAttribute("color", new BufferAttribute(r.colors, 3));
    geo.setAttribute("uv", new BufferAttribute(r.uvs, 2));
    geo.setIndex(this.index);
    const half = node.size / 2;
    geo.boundingBox = new Box3(new Vector3(-half, r.minY, -half), new Vector3(half, r.maxY, half));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new Sphere());
    const mesh = new Mesh(geo, this.material);
    mesh.position.set(node.cx, 0, node.cz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    node.mesh = mesh;
    node.pending = false;
    this.group.add(mesh);
  }

  private remove(node: Node): void {
    if (node.mesh) {
      this.group.remove(node.mesh);
      // the index buffer is shared by every chunk: detach it so dispose() doesn't free it
      node.mesh.geometry.setIndex(null);
      node.mesh.geometry.dispose();
    }
    this.nodes.delete(node.key);
  }
}

const overlaps = (a: Node, b: Node) =>
  Math.abs(a.cx - b.cx) * 2 < a.size + b.size && Math.abs(a.cz - b.cz) * 2 < a.size + b.size;
const dist = (n: Node, p: Vector3) => Math.hypot(n.cx - p.x, n.cz - p.z);
