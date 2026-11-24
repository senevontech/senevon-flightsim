/* Parametric aircraft model: builds any aircraft in the fleet from its Design (designs.ts):
   lathe fuselage with a painted livery, tapered/swept wings and tail, control surfaces hinged on
   their real trailing-edge lines, propellers (nose or wing nacelles) or rear-mounted jets, struts,
   amphibious floats and landing gear that retracts. Moving parts carry the node names from
   docs/ASSETS.md. Open-licence GLB models replace it per aircraft (glbModel.ts, modelSpecs.ts). */
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group,
  LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, SRGBColorSpace, SphereGeometry, Vector2,
  Vector3, type Material,
} from "three";
import type { AircraftSim } from "../sim/aircraft";
import { DEG, type Controls } from "../sim/types";
import { DESIGNS, type Design, type LiftingSurfaceDesign, type Livery } from "./designs";

const glass = new MeshStandardMaterial({ color: "#1b2f42", roughness: 0.05, metalness: 0.85 });
const tyre = new MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.9 });
const metal = new MeshStandardMaterial({ color: "#b9bec6", roughness: 0.3, metalness: 0.8 });
const dark = new MeshStandardMaterial({ color: "#25292f", roughness: 0.55, metalness: 0.3 });

/* Livery painted on a canvas, mapped by the lathe's UVs:
   u = angle around the fuselage (0 = belly, 0.25 = right side, 0.5 = top, 0.75 = left side),
   v = position along it (0 = nose, 1 = tail; canvas top = tail). */
function liveryTexture(lv: Livery): CanvasTexture {
  const W = 1024, H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const y = (v: number) => (1 - v) * H;
  g.fillStyle = lv.base;
  g.fillRect(0, 0, W, H);
  g.fillStyle = lv.belly;
  g.fillRect(0, 0, W * 0.13, H);
  g.fillRect(W * 0.87, 0, W * 0.13, H);
  for (const side of [0.25, 0.75]) {
    // cheat line: thin at the nose, sweeping up the tail
    g.fillStyle = lv.stripe;
    g.beginPath();
    g.moveTo(W * (side - 0.012), y(0.1));
    g.lineTo(W * (side + 0.012), y(0.1));
    g.lineTo(W * (side + 0.03), y(0.98));
    g.lineTo(W * (side - 0.07), y(0.98));
    g.closePath();
    g.fill();
    g.fillStyle = lv.accent;
    g.fillRect(W * (side - 0.03), y(0.98), W * 0.012, y(0.4) - y(0.98));
  }
  // cabin windows on the upper side of each flank
  const w = lv.windows;
  if (w.count) {
    g.fillStyle = "#1b2b3b";
    const step = (w.v1 - w.v0) / w.count;
    for (const [lo, hi] of [[0.29, 0.36], [0.64, 0.71]] as const) {
      for (let k = 0; k < w.count; k++) {
        const v = w.v0 + k * step + step * 0.15;
        g.beginPath();
        g.roundRect(W * lo, y(v + step * 0.7), W * (hi - lo), Math.max(8, H * Math.min(w.tall, step * 0.7)), 14);
        g.fill();
      }
    }
  }
  g.fillStyle = lv.accent === lv.base ? lv.stripe : "#1d2a3a";
  g.font = "bold 64px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [u, rot] of [[0.215, Math.PI / 2], [0.785, -Math.PI / 2]] as const) {
    g.save();
    g.translate(W * u, y(0.72));
    g.rotate(rot);
    g.scale(1, 0.75);
    g.fillText(lv.reg, 0, 0);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A point on a lifting surface: span fraction s (0 root..1 tip), chord fraction f (0 LE..1 TE). */
function surfPoint(d: LiftingSurfaceDesign, side: number, s: number, f: number, vertical = false): Vector3 {
  const chord = d.rootChord + (d.tipChord - d.rootChord) * s;
  const z = d.z + d.sweep * s + chord * f;
  const along = s * (d.span / 2);
  if (vertical) return new Vector3(0, d.y + along, z);
  return new Vector3(side * along, d.y + Math.tan((d.dihedral ?? 0) * DEG) * along, z);
}

/** Tapered, swept panel between span fractions s0..s1 and chord fractions f0..f1. */
export function panel(d: LiftingSurfaceDesign, side: number, s0: number, s1: number, f0: number, f1: number, vertical = false): BufferGeometry {
  const geo = new BoxGeometry(1, 1, 1);
  const p = geo.getAttribute("position");
  const base = d.thickness ?? d.rootChord * 0.12;
  for (let i = 0; i < p.count; i++) {
    const s = s0 + (s1 - s0) * (p.getX(i) + 0.5);
    const f = f0 + (f1 - f0) * (p.getZ(i) + 0.5);
    const pt = surfPoint(d, side, s, f, vertical);
    // thickness tapers toward the tip and toward the trailing edge (airfoil-ish)
    const t = base * (1 - 0.45 * s) * (1 - 0.75 * f) * p.getY(i);
    if (vertical) pt.x += t;
    else pt.y += t;
    p.setXYZ(i, pt.x, pt.y, pt.z);
  }
  geo.computeVertexNormals();
  return geo;
}

interface Hinged {
  pivot: Object3D;
  kind: "aileronL" | "aileronR" | "flap" | "elevator" | "rudder";
}

/** Control surface: geometry re-expressed around its hinge line so it can rotate about it. */
export function hingedSurface(d: LiftingSurfaceDesign, side: number, s0: number, s1: number, f0: number, mat: Material, vertical = false): Object3D {
  const a = surfPoint(d, side, s0, f0, vertical), b = surfPoint(d, side, s1, f0, vertical);
  // hinge axis runs left → right (or bottom → top) so +rotation.x always means trailing edge down/right
  const from = vertical || a.x < b.x ? a : b;
  const to = from === a ? b : a;
  const hinge = new Object3D();
  hinge.position.copy(from);
  hinge.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), to.clone().sub(from).normalize());
  hinge.updateMatrix();
  const geo = panel(d, side, s0, s1, f0, 1, vertical);
  geo.applyMatrix4(new Matrix4().copy(hinge.matrix).invert());
  const pivot = new Group();
  pivot.add(new Mesh(geo, mat));
  hinge.add(pivot);
  return hinge;
}

interface PropRig { blades: Group; disc: Mesh; angle: number }

export class AircraftModel {
  readonly root = new Group();
  private hinged: Hinged[] = [];
  private props: PropRig[] = [];
  private wheels: { mesh: Object3D; leg: Mesh; attachY: number; length: number; radius: number; index: number }[] = [];

  constructor(sim: AircraftSim) {
    const d: Design = DESIGNS[sim.cfg.id] ?? DESIGNS["sparrow-s1"];
    const lv = d.livery;
    const paint = new MeshStandardMaterial({ color: lv.base, roughness: 0.35, metalness: 0.05, side: DoubleSide });
    const stripe = new MeshStandardMaterial({ color: lv.stripe, roughness: 0.4, side: DoubleSide });
    const accent = new MeshStandardMaterial({ color: lv.accent, roughness: 0.4, side: DoubleSide });
    const r = this.root;

    // ---- fuselage ----
    const fus = new Mesh(
      new LatheGeometry(d.profile.map(([rad, z]) => new Vector2(rad, z)), 32),
      new MeshStandardMaterial({ map: liveryTexture(lv), roughness: 0.3, metalness: 0.05 }),
    );
    fus.rotation.x = Math.PI / 2;
    fus.scale.set(d.section[0], 1, d.section[1]);
    fus.position.y = d.fuselageY;
    r.add(fus);

    // ---- canopy ----
    const cp = d.canopy;
    const canopy = cp.type === "bubble"
      ? new Mesh(new SphereGeometry(1, 24, 14), glass)
      : new Mesh(new SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    canopy.scale.set(cp.size[0], cp.size[1], cp.size[2]);
    canopy.position.set(0, cp.y, cp.z);
    if (cp.type === "airliner") canopy.rotation.x = -0.35; // raked windscreen band on the nose
    r.add(canopy);

    // ---- wing + control surfaces ----
    for (const side of [-1, 1]) {
      r.add(new Mesh(panel(d.wing, side, 0, 1, 0, 0.72), paint));
      r.add(new Mesh(panel(d.wing, side, 0.94, 1, 0.72, 1), accent)); // tip
      r.add(new Mesh(panel(d.wing, side, 0, 0.1, 0.72, 1), paint)); // root fillet
      const flap = hingedSurface(d.wing, side, 0.1, 0.56, 0.72, paint);
      const ail = hingedSurface(d.wing, side, 0.58, 0.94, 0.72, paint);
      flap.children[0].name = side < 0 ? "flap_L" : "flap_R";
      ail.children[0].name = side < 0 ? "aileron_L" : "aileron_R";
      r.add(flap, ail);
      this.hinged.push({ pivot: flap.children[0], kind: "flap" }, { pivot: ail.children[0], kind: side < 0 ? "aileronL" : "aileronR" });
      // horizontal tail
      r.add(new Mesh(panel(d.hstab, side, 0, 1, 0, 0.62), paint));
      const elev = hingedSurface(d.hstab, side, 0.02, 1, 0.62, stripe);
      elev.children[0].name = side < 0 ? "elevator_L" : "elevator_R";
      r.add(elev);
      this.hinged.push({ pivot: elev.children[0], kind: "elevator" });
    }
    // fin + rudder
    const fin = { ...d.fin, span: d.fin.height * 2, dihedral: 0, thickness: d.fin.rootChord * 0.1 };
    r.add(new Mesh(panel(fin, 1, 0, 1, 0, 0.65, true), paint));
    r.add(new Mesh(panel(fin, 1, 0.82, 1, 0, 0.65, true), stripe));
    const rudder = hingedSurface(fin, 1, 0.02, 1, 0.65, stripe, true);
    rudder.children[0].name = "rudder"; // hinge axis is this node's local X
    r.add(rudder);
    this.hinged.push({ pivot: rudder.children[0], kind: "rudder" });

    // ---- wing struts (high wings) ----
    if (d.struts) {
      for (const s of [-1, 1]) {
        const a = new Vector3(s * d.section[0] * 0.6, d.fuselageY - 0.3, d.wing.z + d.wing.rootChord * 0.4);
        const b = surfPoint(d.wing, s, 0.45, 0.35);
        const strut = new Mesh(new CylinderGeometry(0.04, 0.04, a.distanceTo(b), 6), metal);
        strut.position.copy(a).add(b).multiplyScalar(0.5);
        strut.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
        r.add(strut);
      }
    }

    // ---- engines ----
    for (const e of d.engines) {
      const [x, y, z] = e.pos;
      if (e.kind === "rearJet") {
        const [len, rad] = e.nacelle ?? [2.5, 0.4];
        const nac = new Mesh(new CylinderGeometry(rad * 0.92, rad, len, 20), paint);
        nac.rotation.x = Math.PI / 2;
        nac.position.set(x, y, z);
        const intake = new Mesh(new CircleGeometry(rad * 0.85, 20), dark);
        intake.position.set(x, y, z - len / 2 - 0.01);
        intake.rotation.y = Math.PI;
        const exhaust = new Mesh(new CircleGeometry(rad * 0.7, 20), dark);
        exhaust.position.set(x, y, z + len / 2 + 0.01);
        const pylon = new Mesh(new BoxGeometry(Math.abs(x) - 0.5, 0.12, len * 0.5), paint);
        pylon.position.set(x / 2 + Math.sign(x) * 0.25, y, z);
        r.add(nac, intake, exhaust, pylon);
        continue;
      }
      if (e.kind === "wingProp") {
        const [len, rad] = e.nacelle ?? [3, 0.45];
        const nac = new Mesh(new CylinderGeometry(rad * 0.55, rad, len, 18), paint);
        nac.rotation.x = Math.PI / 2;
        nac.position.set(x, y, z + len / 2);
        const cowl = new Mesh(new SphereGeometry(rad, 18, 10), paint);
        cowl.scale.set(1, 1, 0.8);
        cowl.position.set(x, y, z);
        r.add(nac, cowl);
      } else if (e.propDia > 2.2) {
        // big radial: open cowling ring
        const cowl = new Mesh(new CylinderGeometry(0.62, 0.66, 0.7, 24, 1, true), dark);
        cowl.rotation.x = Math.PI / 2;
        cowl.position.set(x, y, z + 0.35);
        r.add(cowl);
      }
      this.props.push(this.buildProp(r, new Vector3(x, y, z - (e.kind === "wingProp" ? 0.35 : 0)), e.propDia, e.blades));
    }

    // ---- floats ----
    if (d.floats) {
      const f = d.floats;
      const len = f.z1 - f.z0;
      const prof = [[0, 0], [0.55, 0.06], [0.95, 0.2], [1, 0.45], [0.85, 0.8], [0.35, 0.97], [0, 1]].map(([rr, t]) => new Vector2(rr * f.width / 2, t * len));
      for (const s of [-1, 1]) {
        const pont = new Mesh(new LatheGeometry(prof, 14), paint);
        pont.rotation.x = Math.PI / 2;
        pont.scale.set(1, 1, f.height / f.width);
        pont.position.set(s * f.x, f.y, f.z0);
        r.add(pont);
        for (const zz of [f.z0 + len * 0.3, f.z0 + len * 0.62]) {
          const a = new Vector3(s * f.x, f.y + f.height / 2, zz), b = new Vector3(s * 0.45, d.fuselageY - 0.6, zz);
          const st = new Mesh(new CylinderGeometry(0.045, 0.045, a.distanceTo(b), 6), metal);
          st.position.copy(a).add(b).multiplyScalar(0.5);
          st.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
          r.add(st);
        }
      }
    }

    // ---- landing gear ----
    sim.cfg.gear.forEach((g, index) => {
      if (g.kind === "float") return;
      const wheel = new Mesh(new CylinderGeometry(g.wheelRadius, g.wheelRadius, 0.16, 16), tyre);
      wheel.rotation.z = Math.PI / 2;
      const holder = new Group();
      holder.add(wheel);
      holder.position.set(g.pos[0], 0, g.pos[2]);
      const leg = new Mesh(new CylinderGeometry(0.04, 0.05, 1, 6), metal);
      leg.position.set(g.pos[0], 0, g.pos[2]);
      holder.name = `gear_${index}`;
      leg.name = `gear_leg_${index}`;
      r.add(holder, leg);
      this.wheels.push({ mesh: holder, leg, attachY: g.pos[1], length: g.length, radius: g.wheelRadius, index });
    });

    r.traverse((o) => {
      if ((o as Mesh).isMesh && !this.props.some((p) => p.disc === o)) o.castShadow = true;
    });
  }

  private buildProp(parent: Object3D, at: Vector3, dia: number, blades: number): PropRig {
    const prop = new Group();
    prop.position.copy(at);
    const spinner = new Mesh(new ConeGeometry(dia * 0.09, dia * 0.22, 14), metal);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -dia * 0.11;
    const bladeGroup = new Group();
    bladeGroup.name = "prop";
    for (let k = 0; k < blades; k++) {
      const holder = new Group();
      holder.rotation.z = (k / blades) * Math.PI * 2;
      const blade = new Mesh(new BoxGeometry(dia * 0.065, dia * 0.48, 0.03), dark);
      blade.position.y = dia * 0.25;
      blade.rotation.y = 0.35;
      holder.add(blade);
      bladeGroup.add(holder);
    }
    const disc = new Mesh(
      new CircleGeometry(dia / 2, 32),
      new MeshStandardMaterial({ color: "#222", transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
    );
    prop.add(spinner, bladeGroup, disc);
    parent.add(prop);
    return { blades: bladeGroup, disc, angle: Math.random() * 6 };
  }

  update(pos: Vector3, q: Quaternion, c: Controls, sim: AircraftSim, dt: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    // control surfaces (+ rotation.x = trailing edge down / right)
    for (const h of this.hinged) {
      switch (h.kind) {
        case "aileronL": h.pivot.rotation.x = c.roll * 18 * DEG; break;
        case "aileronR": h.pivot.rotation.x = -c.roll * 18 * DEG; break;
        case "flap": h.pivot.rotation.x = sim.flaps * 32 * DEG; break;
        case "elevator": h.pivot.rotation.x = -(c.pitch + c.trim * 0.3) * 24 * DEG; break;
        case "rudder": h.pivot.rotation.x = c.yaw * 25 * DEG; break;
      }
    }
    // propellers blur into discs as rpm rises
    const blur = Math.min(1, Math.max(0, (sim.rpm - 500) / 900));
    for (const p of this.props) {
      p.angle += (sim.rpm / 60) * Math.PI * 2 * dt;
      p.blades.rotation.z = p.angle;
      p.blades.visible = blur < 0.95;
      (p.disc.material as MeshStandardMaterial).opacity = blur * 0.28;
    }
    // wheels follow strut compression and fold away with the gear
    const down = sim.gearDown;
    for (const v of this.wheels) {
      const w = sim.wheels[v.index];
      const extension = (v.length - (w.contact ? w.compression : 0)) * down;
      v.mesh.position.y = v.attachY - extension + v.radius * down;
      v.mesh.visible = v.leg.visible = down > 0.05;
      v.mesh.scale.setScalar(Math.max(0.05, down));
      v.leg.scale.y = Math.max(0.05, extension - v.radius + 0.1);
      v.leg.position.y = v.attachY - (extension - v.radius) / 2;
    }
  }
}
