/* Airport visuals for every airport in the world: runway surfaces + markings (every runway),
   apron, taxiway, hangars / tower by airport size, PAPI lights (both runway ends), windsocks,
   and the approach guide rings for the runway the player is heading for.
   Each airport lives in its own group. With `lazyRadius` set (the real-world mode, where an
   area can hold a hundred airports), an airport is only built when the camera comes within
   that distance and is disposed again well beyond it; runway textures are 5 MB each. */
import {
  AdditiveBlending, BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PerspectiveCamera, PlaneGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from "three";
import { glowTexture, grassRunwayTexture, runwayTexture } from "./textures";
import type { Airport, Runway } from "../world/WorldProvider";
import { DEG } from "../sim/types";

type Size = "major" | "regional" | "strip";

const wall = new MeshStandardMaterial({ color: "#d8d4cc", roughness: 0.8 });
const roofMat = new MeshStandardMaterial({ color: "#7d8691", roughness: 0.6, metalness: 0.3 });
const accent = new MeshStandardMaterial({ color: "#ff6a00", roughness: 0.7 });
const asphalt = new MeshStandardMaterial({ color: "#55585c", roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 });
const glassMat = new MeshStandardMaterial({ color: "#2a4258", roughness: 0.15, metalness: 0.6 });
const glow = glowTexture();

interface Papi { sprite: Sprite; pos: Vector3; angle: number }

interface Site {
  airport: Airport;
  size: Size;
  center: Vector3;
  root: Group | null;
  buildings: Group | null;
  papis: Papi[];
  socks: Object3D[];
}

/** Materials and textures shared by every airport (never disposed with a site). */
const SHARED = new Set<unknown>([wall, roofMat, accent, asphalt, glassMat, glow]);

export class AirportVisuals {
  readonly group = new Group();
  private sites: Site[] = [];
  private gates = new Group();
  private guideFor: Runway | null = null;
  private lastLazy = -Infinity;

  constructor(airports: Airport[], sizes: Map<string, Size>, private lazyRadius = 0) {
    for (const a of airports) {
      const r0 = a.runways[0];
      const h = r0.headingDeg * DEG;
      const center = new Vector3(r0.threshold.x + Math.sin(h) * r0.length / 2, a.elevation, r0.threshold.z - Math.cos(h) * r0.length / 2);
      const site: Site = { airport: a, size: sizes.get(a.id) ?? "regional", center, root: null, buildings: null, papis: [], socks: [] };
      this.sites.push(site);
      if (!lazyRadius) this.build(site);
    }
    this.group.add(this.gates);
  }

  /** Lazy mode: build the nearest unbuilt airport in range (one per call) and drop far ones. */
  private stream(cam: Vector3, now: number): void {
    if (now - this.lastLazy < 500) return;
    this.lastLazy = now;
    let next: Site | null = null, nextD = Infinity;
    for (const s of this.sites) {
      const d = Math.hypot(s.center.x - cam.x, s.center.z - cam.z);
      if (s.root && d > this.lazyRadius * 1.4) this.dispose(s);
      else if (!s.root && d < this.lazyRadius && d < nextD) { next = s; nextD = d; }
    }
    if (next) this.build(next);
  }

  private dispose(s: Site): void {
    s.root?.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = (m as { material?: unknown }).material;
      for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        const mm = mat as MeshStandardMaterial;
        if (SHARED.has(mm)) continue;
        if (mm.map && !SHARED.has(mm.map)) mm.map.dispose();
        mm.dispose();
      }
    });
    if (s.root) this.group.remove(s.root);
    s.root = s.buildings = null;
    s.papis = [];
    s.socks = [];
  }

  /** One runway's surface (paved with markings, or a mown grass strip). */
  private surface(root: Group, r0: Runway, r1: Runway | undefined, y: number): void {
    const h = r0.headingDeg * DEG;
    const center = new Vector3(r0.threshold.x + Math.sin(h) * r0.length / 2, y, r0.threshold.z - Math.cos(h) * r0.length / 2);
    const tex = r0.surface === "grass" ? grassRunwayTexture(r0) : runwayTexture(r0, r1?.name ?? "");
    const surf = new Mesh(
      new PlaneGeometry(r0.width, r0.length),
      new MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    surf.rotation.set(-Math.PI / 2, 0, -h);
    surf.position.copy(center).setY(y + 0.08);
    surf.receiveShadow = true;
    root.add(surf);
  }

  private build(site: Site): void {
    const a = site.airport, size = site.size;
    const root = (site.root = new Group());
    this.group.add(root);
    const r0 = a.runways[0];
    const h = r0.headingDeg * DEG;
    const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const center = site.center;
    const y = a.elevation;
    const grass = r0.surface === "grass";

    // runway surfaces: the first pair, then any further runways (real airports)
    for (let k = 0; k < a.runways.length; k += 2) this.surface(root, a.runways[k], a.runways[k + 1], y);

    // buildings on the right side of runway r0, near the middle
    const buildings = new Group();
    const place = (o: Object3D, cross: number, along: number, oy = 0) => {
      o.position.set(center.x + rx * cross + fx * along, y + oy, center.z + rz * cross + fz * along);
      o.rotation.y = -h;
      return o;
    };
    if (!grass) {
      // taxiway from the runway edge to the apron (apron starts 75 m out)
      const taxi = place(new Mesh(new PlaneGeometry(14, 1), asphalt), r0.width / 2 + 37.5, 0, 0.07);
      taxi.scale.y = 75;
      taxi.rotation.set(-Math.PI / 2, 0, -h + Math.PI / 2);
      const apronLen = size === "major" ? 360 : 160;
      const apron = place(new Mesh(new PlaneGeometry(90, apronLen), asphalt), r0.width / 2 + 120, 0, 0.07);
      apron.rotation.set(-Math.PI / 2, 0, -h);
      taxi.receiveShadow = apron.receiveShadow = true;
      buildings.add(taxi, apron);
    }
    const nHangars = size === "major" ? 4 : size === "regional" ? 2 : 1;
    for (let i = 0; i < nHangars; i++) {
      buildings.add(place(this.hangar(size === "strip" ? 0.6 : 1), r0.width / 2 + 190, (i - (nHangars - 1) / 2) * 48));
    }
    if (size !== "strip") buildings.add(place(this.tower(size === "major" ? 26 : 14), r0.width / 2 + 160, (nHangars / 2) * 48 + 40));
    if (size === "major") {
      const terminal = new Mesh(new BoxGeometry(40, 12, 120), glassMat);
      terminal.position.y = 6;
      const g = new Group();
      g.add(terminal);
      buildings.add(place(g, r0.width / 2 + 200, -170));
    }
    buildings.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    root.add(buildings);
    site.buildings = buildings;

    // windsock beside the first threshold, PAPI at both ends of every paved runway
    site.socks.push(this.windsock(root, new Vector3(r0.threshold.x - rx * (r0.width / 2 + 30) + fx * 120, y, r0.threshold.z - rz * (r0.width / 2 + 30) + fz * 120)));
    for (const r of a.runways) if (r.surface !== "grass") this.papi(site, r, y);
  }

  private hangar(scale: number): Group {
    const g = new Group();
    const body = new Mesh(new BoxGeometry(30, 9, 26), wall);
    body.position.y = 4.5;
    const top = new Mesh(new CylinderGeometry(15, 15, 26, 16, 1, false, 0, Math.PI), roofMat);
    top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    top.scale.set(1, 1, 0.3);
    top.position.y = 9;
    const door = new Mesh(new BoxGeometry(0.3, 7, 22), accent);
    door.position.set(-15.1, 3.5, 0);
    g.add(body, top, door);
    g.scale.setScalar(scale);
    return g;
  }

  private tower(height: number): Group {
    const t = new Group();
    const shaft = new Mesh(new CylinderGeometry(2.2, 2.8, height, 12), wall);
    shaft.position.y = height / 2;
    const cab = new Mesh(new CylinderGeometry(4.2, 3.4, 4, 8), glassMat);
    cab.position.y = height + 2;
    const cap = new Mesh(new CylinderGeometry(4.6, 4.6, 0.8, 8), accent);
    cap.position.y = height + 4.4;
    t.add(shaft, cab, cap);
    return t;
  }

  private windsock(root: Group, pos: Vector3): Object3D {
    const pole = new Mesh(new CylinderGeometry(0.08, 0.1, 6, 6), new MeshStandardMaterial({ color: "#ddd" }));
    const pivot = new Group();
    pivot.rotation.order = "YXZ"; // droop locally, then turn downwind
    const sock = new Mesh(new CylinderGeometry(0.45, 0.2, 3.2, 10, 1, true), new MeshStandardMaterial({ color: "#ff6a00", side: DoubleSide }));
    sock.rotation.x = Math.PI / 2;
    sock.position.z = 1.6;
    pivot.add(sock);
    pivot.position.y = 5.8;
    const g = new Group();
    pole.position.y = 3;
    g.add(pole, pivot);
    g.position.copy(pos);
    root.add(g);
    return pivot;
  }

  private papi(site: Site, r: Runway, y: number): void {
    const h = r.headingDeg * DEG;
    const fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    [3.5, 3.17, 2.83, 2.5].forEach((angle, i) => {
      const cross = -(r.width / 2 + 12 + i * 9);
      const pos = new Vector3(r.threshold.x + fx * r.aimPoint + rx * cross, y + 1, r.threshold.z + fz * r.aimPoint + rz * cross);
      const sprite = new Sprite(new SpriteMaterial({ map: glow, color: "#ffffff", blending: AdditiveBlending, depthWrite: false, fog: false }));
      sprite.position.copy(pos);
      const box = new Mesh(new BoxGeometry(1.2, 0.8, 0.6), new MeshStandardMaterial({ color: "#333" }));
      box.position.copy(pos).setY(y + 0.5);
      box.rotation.y = -h;
      site.root!.add(sprite, box);
      site.papis.push({ sprite, pos, angle });
    });
  }

  /** Show approach rings for this runway (null hides them). */
  setGuide(r: Runway | null): void {
    if (r === this.guideFor) return;
    this.guideFor = r;
    this.gates.clear();
    if (!r) return;
    const h = r.headingDeg * DEG;
    const fx = Math.sin(h), fz = -Math.cos(h);
    const mat = new MeshBasicMaterial({ color: "#ff8a3d", transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false });
    const geo = new TorusGeometry(16, 0.35, 6, 40);
    for (let d = 500; d <= 5000; d += 450) {
      const g = new Mesh(geo, mat);
      const along = r.aimPoint - d;
      g.position.set(r.threshold.x + fx * along, r.threshold.y + Math.tan(3 * DEG) * d + 3, r.threshold.z + fz * along);
      g.rotation.y = -h;
      g.scale.y = 0.62;
      this.gates.add(g);
    }
  }

  update(camera: PerspectiveCamera, wind: Vector3, showGates: boolean, now = performance.now()): void {
    const cam = camera.position;
    if (this.lazyRadius) this.stream(cam, now);
    const ws = Math.hypot(wind.x, wind.z);
    for (const s of this.sites) {
      if (!s.root) continue;
      for (const l of s.papis) {
        const dist = Math.hypot(cam.x - l.pos.x, cam.z - l.pos.z);
        l.sprite.visible = dist < 15000;
        if (!l.sprite.visible) continue;
        const ang = Math.atan2(cam.y - l.pos.y, dist) / DEG;
        l.sprite.material.color.set(ang > l.angle ? "#ffffff" : "#ff2a1a");
        l.sprite.scale.setScalar(Math.max(2, Math.hypot(dist, cam.y - l.pos.y) * 0.012));
      }
      if (s.buildings) s.buildings.visible = s.center.distanceTo(cam) < 14000;
      for (const sock of s.socks) {
        sock.rotation.y = Math.atan2(wind.x, wind.z);
        sock.rotation.x = (1 - Math.min(ws / 8, 1)) * 1.2;
      }
    }
    this.gates.visible = showGates && !!this.guideFor;
  }

  /** Airports not built yet near the camera (lazy mode), for the loading screen. */
  pendingNear(cam: Vector3, radius: number): number {
    let n = 0;
    for (const s of this.sites) if (!s.root && Math.hypot(s.center.x - cam.x, s.center.z - cam.z) < radius) n++;
    return n;
  }
}
