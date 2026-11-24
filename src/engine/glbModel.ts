/* Aircraft from a GLB file (open-licence model, see modelSpecs.ts):
   - fitted to the flight model: turned nose-forward, scaled to the design's wingspan, centred on
     the fuselage and set so the wheels touch the ground where the sim's gear does;
   - moving parts found by node name (DEFAULT_PARTS) and driven like the coded model: ailerons,
     flaps, elevator, rudder (hinged about their own origin), propellers (spin, then blur into a
     disc) and landing gear (folds away with the gear lever).
   AircraftVisual shows the coded model at once and swaps to the GLB when it has loaded, so a
   missing or broken file never leaves the player without an aircraft. */
import {
  Box3, CircleGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { AircraftSim } from "../sim/aircraft";
import { DEG, type AircraftConfig, type Controls } from "../sim/types";
import { AircraftModel } from "./aircraftModel";
import { DESIGNS } from "./designs";
import { DEFAULT_PARTS, MODEL_SPECS, type ModelSpec, type PartBinding, type PartKind } from "./modelSpecs";

export interface BoundPart {
  kind: PartKind;
  node: Object3D;
  rest: Quaternion;
  restScale: Vector3;
  axis: Vector3;
  sign: number;
  /** Propellers: the blur disc and the current blade angle. */
  disc?: Mesh;
  angle?: number;
}

/** Find the moving parts by node name. A node inside an already bound part is skipped, so a
    "gear_main" group binds once rather than once per wheel inside it. */
export function bindParts(root: Object3D, bindings: PartBinding[] = DEFAULT_PARTS): BoundPart[] {
  const out: BoundPart[] = [];
  const bound = new Set<Object3D>();
  const insideBound = (o: Object3D) => {
    for (let p = o.parent; p; p = p.parent) if (bound.has(p)) return true;
    return false;
  };
  root.traverse((node) => {
    if (!node.name || insideBound(node)) return;
    const b = bindings.find((x) => x.match.test(node.name));
    if (!b) return;
    const axis = new Vector3(...(b.axis ?? (b.kind === "prop" ? [0, 0, 1] : [1, 0, 0]))).normalize();
    out.push({ kind: b.kind, node, rest: node.quaternion.clone(), restScale: node.scale.clone(), axis, sign: b.sign ?? 1 });
    bound.add(node);
  });
  return out;
}

/** Deflection (radians) of a hinged part for the current controls — same signs as the coded model. */
export function deflection(kind: PartKind, c: Controls, flaps: number): number {
  switch (kind) {
    case "aileronL": return c.roll * 18 * DEG;
    case "aileronR": return -c.roll * 18 * DEG;
    case "flap": return flaps * 32 * DEG;
    case "elevator": return -(c.pitch + c.trim * 0.3) * 24 * DEG;
    case "rudder": return c.yaw * 25 * DEG;
    default: return 0;
  }
}

/** Fit a loaded model into the aircraft's body frame (+X right, +Y up, −Z forward). */
export function fitModel(model: Object3D, cfg: AircraftConfig, spec: Pick<ModelSpec, "yawDeg" | "span" | "offset">): Group {
  const holder = new Group();
  model.rotation.y = (spec.yawDeg ?? 0) * DEG;
  holder.add(model);
  holder.updateMatrixWorld(true);
  const box = new Box3().setFromObject(holder, true);
  const design = DESIGNS[cfg.id];
  const span = spec.span ?? design?.wing.span ?? 10;
  const width = box.max.x - box.min.x;
  const s = width > 0 ? span / width : 1;
  model.scale.multiplyScalar(s);
  holder.updateMatrixWorld(true);
  box.setFromObject(holder, true);
  // fuselage centre (along z) from the design profile; ground from the gear contact points
  const prof = design?.profile;
  const zMid = prof ? (prof[0][1] + prof[prof.length - 1][1]) / 2 : 0;
  const groundY = Math.min(...cfg.gear.map((g) => g.pos[1] - (g.kind === "float" ? 0 : g.length)));
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z += zMid - (box.min.z + box.max.z) / 2;
  model.position.y += groundY - box.min.y;
  if (spec.offset) model.position.add(new Vector3(...spec.offset));
  return holder;
}

export class GlbAircraftModel {
  readonly root = new Group();
  private parts: BoundPart[];

  constructor(scene: Object3D, sim: AircraftSim, spec: ModelSpec) {
    const model = scene.clone(true);
    if (spec.hide) model.traverse((o) => { if (spec.hide!.test(o.name)) o.visible = false; });
    model.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.parts = bindParts(model, spec.parts ?? DEFAULT_PARTS);
    this.root.add(fitModel(model, sim.cfg, spec));
    this.root.updateMatrixWorld(true);
    // propeller blur discs, sized from the propeller's extent (converted to its parent's units)
    for (const p of this.parts) {
      if (p.kind !== "prop" || !p.node.parent) continue;
      const size = new Box3().setFromObject(p.node, true).getSize(new Vector3());
      const radius = Math.max(size.x, size.y, size.z) / 2 / Math.max(1e-6, worldScale(p.node.parent));
      const disc = new Mesh(
        new CircleGeometry(radius, 32),
        new MeshStandardMaterial({ color: "#222", transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
      );
      disc.position.copy(p.node.position);
      disc.quaternion.copy(p.node.quaternion).multiply(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), p.axis));
      p.node.parent.add(disc);
      p.disc = disc;
      p.angle = Math.random() * 6;
    }
  }

  /** Names of the parts that were found (for the dev console / diagnostics). */
  get boundParts(): string[] {
    return this.parts.map((p) => `${p.kind}:${p.node.name}`);
  }

  update(pos: Vector3, q: Quaternion, c: Controls, sim: AircraftSim, dt: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    const blur = Math.min(1, Math.max(0, (sim.rpm - 500) / 900));
    const spin = new Quaternion();
    for (const p of this.parts) {
      if (p.kind === "prop") {
        p.angle = (p.angle ?? 0) + (sim.rpm / 60) * Math.PI * 2 * dt;
        p.node.quaternion.copy(p.rest).multiply(spin.setFromAxisAngle(p.axis, p.angle));
        p.node.visible = blur < 0.95;
        if (p.disc) (p.disc.material as MeshStandardMaterial).opacity = blur * 0.28;
      } else if (p.kind === "gear") {
        const down = sim.gearDown;
        p.node.visible = down > 0.05;
        p.node.scale.copy(p.restScale).multiplyScalar(Math.max(0.05, down));
      } else {
        p.node.quaternion.copy(p.rest).multiply(spin.setFromAxisAngle(p.axis, p.sign * deflection(p.kind, c, sim.flaps)));
      }
    }
  }
}

function worldScale(o: Object3D): number {
  o.updateWorldMatrix(true, false);
  return new Vector3().setFromMatrixScale(o.matrixWorld).x;
}

// ---- loading (one request per file, shared between aircraft switches) ----
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<Object3D>>();
function loadScene(file: string): Promise<Object3D> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/${file}`).then((g) => g.scene);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

/** The model the player sees: coded at first, GLB once loaded (if this aircraft has one).
    `?model=coded` forces the coded model; in dev, `?glb=<file>` tries any file for any aircraft. */
export class AircraftVisual {
  readonly root = new Group();
  private impl: AircraftModel | GlbAircraftModel;
  private alive = true;
  /** "coded", "loading", "glb" or "failed: …" (shown in the dev handle). */
  status = "coded";

  constructor(sim: AircraftSim) {
    this.impl = new AircraftModel(sim);
    this.root.add(this.impl.root);
    const spec = modelSpecFor(sim.cfg.id);
    if (!spec) return;
    this.status = "loading";
    loadScene(spec.file).then(
      (scene) => {
        if (!this.alive) return;
        const glb = new GlbAircraftModel(scene, sim, spec);
        glb.root.position.copy(this.impl.root.position);
        glb.root.quaternion.copy(this.impl.root.quaternion);
        this.root.remove(this.impl.root);
        this.root.add(glb.root);
        this.impl = glb;
        this.status = "glb";
      },
      (err: unknown) => {
        this.status = `failed: ${String(err)}`;
        console.warn(`Aircraft model ${spec.file} failed to load; using the coded model.`, err);
      },
    );
  }

  get parts(): string[] {
    return this.impl instanceof GlbAircraftModel ? this.impl.boundParts : [];
  }

  update(pos: Vector3, q: Quaternion, c: Controls, sim: AircraftSim, dt: number): void {
    this.impl.update(pos, q, c, sim, dt);
  }

  dispose(): void {
    this.alive = false;
  }
}

function modelSpecFor(id: string): ModelSpec | null {
  const params = new URLSearchParams(location.search);
  if (params.get("model") === "coded") return null;
  const devFile = import.meta.env.DEV ? params.get("glb") : null;
  if (devFile) {
    const base: ModelSpec = MODEL_SPECS[id] ?? { file: devFile, credit: { title: "dev test", author: "-", licence: "Original", source: "-" } };
    return { ...base, file: devFile };
  }
  return MODEL_SPECS[id] ?? null;
}
