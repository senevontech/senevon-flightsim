/* Placeholder Sparrow S1 built from primitives, with working control surfaces, propeller and
   gear. Replaced by a GLB model later (docs/ASSETS.md lists the required node names). */
import {
  BoxGeometry, CanvasTexture, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh,
  MeshStandardMaterial, Object3D, Quaternion, SRGBColorSpace, SphereGeometry, Vector2, Vector3,
} from "three";
import type { AircraftSim } from "../sim/aircraft";
import { DEG, type Controls } from "../sim/types";

const white = new MeshStandardMaterial({ color: "#f3f1ec", roughness: 0.35, metalness: 0.05 });
const orange = new MeshStandardMaterial({ color: "#ff6a00", roughness: 0.4 });
const dark = new MeshStandardMaterial({ color: "#2b2f36", roughness: 0.6 });
const glass = new MeshStandardMaterial({ color: "#1d3346", roughness: 0.05, metalness: 0.8 });
const tyre = new MeshStandardMaterial({ color: "#1a1a1a", roughness: 0.9 });
const metal = new MeshStandardMaterial({ color: "#b9bec6", roughness: 0.3, metalness: 0.8 });

/* Fuselage livery painted on a canvas, mapped by the lathe's UVs:
   u = angle around the fuselage (0 = belly, 0.25 = right side, 0.5 = top, 0.75 = left side),
   v = position along it (0 = nose, 1 = tail; canvas top = tail). */
function liveryTexture(registration: string): CanvasTexture {
  const W = 1024, H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const y = (v: number) => (1 - v) * H; // canvas y for a position along the fuselage
  g.fillStyle = "#f4f2ed";
  g.fillRect(0, 0, W, H);
  // belly in light grey
  g.fillStyle = "#c9ccd1";
  g.fillRect(0, 0, W * 0.13, H);
  g.fillRect(W * 0.87, 0, W * 0.13, H);
  // cheat line on both sides: thin near the nose, sweeping wider toward the tail
  for (const side of [0.25, 0.75]) {
    g.fillStyle = "#ff6a00";
    g.beginPath();
    g.moveTo(W * (side - 0.012), y(0.12));
    g.lineTo(W * (side + 0.012), y(0.12));
    g.lineTo(W * (side + 0.03), y(0.98));
    g.lineTo(W * (side - 0.07), y(0.98));
    g.closePath();
    g.fill();
    g.fillStyle = "#1d2a3a";
    g.fillRect(W * (side - 0.03), y(0.98), W * 0.012, y(0.35) - y(0.98));
  }
  // side windows (upper half of each side, over the cabin)
  g.fillStyle = "#1b2b3b";
  for (const [lo, hi] of [[0.3, 0.38], [0.62, 0.7]] as const) {
    g.beginPath();
    g.roundRect(W * lo, y(0.42), W * (hi - lo), y(0.2) - y(0.42), 18);
    g.fill();
  }
  // registration near the tail, readable from each side (see orientation notes above)
  g.fillStyle = "#1d2a3a";
  g.font = "bold 64px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [u, rot] of [[0.215, Math.PI / 2], [0.785, -Math.PI / 2]] as const) {
    g.save();
    g.translate(W * u, y(0.68));
    g.rotate(rot);
    g.scale(1, 0.75);
    g.fillText(registration, 0, 0);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function box(w: number, h: number, d: number, mat: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** A control surface hinged along X (or Y for the rudder) at its leading edge. */
function hinged(w: number, h: number, chord: number, mat: MeshStandardMaterial, x: number, y: number, z: number): Group {
  const g = new Group();
  g.position.set(x, y, z);
  g.add(box(w, h, chord, mat, 0, 0, chord / 2));
  return g;
}

export class AircraftModel {
  readonly root = new Group();
  private aileronL: Group;
  private aileronR: Group;
  private flapL: Group;
  private flapR: Group;
  private elevator: Group;
  private rudder: Group;
  private prop = new Group();
  private propBlades = new Group();
  private propDisc: Mesh;
  private wheels: { mesh: Object3D; leg: Mesh; attachY: number; length: number; radius: number }[] = [];
  private propAngle = 0;

  constructor(sim: AircraftSim) {
    const r = this.root;
    // fuselage: lathe profile along Z (nose at −Z)
    const profile = [
      [0.0, -2.62], [0.3, -2.55], [0.48, -2.3], [0.57, -1.9], [0.62, -1.0], [0.63, 0.0], [0.56, 1.0],
      [0.4, 2.4], [0.26, 3.8], [0.16, 5.0], [0.0, 5.25],
    ].map(([rad, z]) => new Vector2(rad, z));
    const livery = new MeshStandardMaterial({ map: liveryTexture("SW-01K"), roughness: 0.3, metalness: 0.05 });
    const fus = new Mesh(new LatheGeometry(profile, 32), livery);
    fus.rotation.x = Math.PI / 2;
    fus.scale.set(0.92, 1, 1.08);
    fus.position.y = 0.05;
    r.add(fus);
    // windscreen: a flattened glass dome over the front of the cabin
    const screen = new Mesh(new SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    screen.scale.set(0.82, 0.55, 1.15);
    screen.position.set(0, 0.42, -0.75);
    r.add(screen);

    // wing (high wing, slight dihedral ignored visually)
    r.add(box(10.4, 0.12, 1.15, white, 0, 1.02, -0.03));
    for (const s of [-1, 1]) {
      // rounded orange wingtips
      const tip = new Mesh(new CylinderGeometry(0.06, 0.06, 1.15, 10), orange);
      tip.rotation.x = Math.PI / 2;
      tip.scale.set(4.5, 1, 1);
      tip.position.set(s * 5.25, 1.02, -0.03);
      r.add(tip);
    }
    this.aileronL = hinged(2.0, 0.08, 0.35, white, -4.3, 1.02, 0.54);
    this.aileronR = hinged(2.0, 0.08, 0.35, white, 4.3, 1.02, 0.54);
    this.flapL = hinged(2.5, 0.08, 0.38, white, -2.05, 1.02, 0.54);
    this.flapR = hinged(2.5, 0.08, 0.38, white, 2.05, 1.02, 0.54);
    r.add(this.aileronL, this.aileronR, this.flapL, this.flapR);
    // struts
    for (const s of [-1, 1]) {
      const a = new Vector3(s * 0.55, -0.25, 0.1), b = new Vector3(s * 2.7, 0.97, 0.1);
      const strut = new Mesh(new CylinderGeometry(0.035, 0.035, a.distanceTo(b), 6), metal);
      strut.position.copy(a).add(b).multiplyScalar(0.5);
      strut.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
      r.add(strut);
    }

    // tail
    r.add(box(3.4, 0.08, 0.7, white, 0, 0.2, 4.45));
    this.elevator = hinged(3.4, 0.06, 0.45, orange, 0, 0.2, 4.8);
    r.add(this.elevator);
    const fin = box(0.08, 1.3, 0.95, white, 0, 0.85, 4.62);
    r.add(fin, box(0.09, 0.3, 0.95, orange, 0, 1.4, 4.62));
    this.rudder = hinged(0.06, 1.3, 0.42, orange, 0, 0.85, 5.1);
    r.add(this.rudder);

    // propeller
    const spinner = new Mesh(new ConeGeometry(0.17, 0.42, 14), metal);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -0.21;
    this.prop.add(spinner);
    for (const a of [0, Math.PI]) {
      const blade = box(0.13, 0.92, 0.03, dark, 0, 0.47, 0);
      const holder = new Group();
      holder.rotation.z = a;
      blade.rotation.y = 0.35;
      holder.add(blade);
      this.propBlades.add(holder);
    }
    this.propDisc = new Mesh(
      new CircleGeometry(0.95, 32),
      new MeshStandardMaterial({ color: "#222", transparent: true, opacity: 0, side: DoubleSide, depthWrite: false }),
    );
    this.prop.add(this.propBlades, this.propDisc);
    this.prop.position.set(0, 0.1, -2.62);
    r.add(this.prop);

    // landing gear
    for (const g of sim.cfg.gear) {
      const wheel = new Mesh(new CylinderGeometry(g.wheelRadius, g.wheelRadius, 0.16, 16), tyre);
      wheel.rotation.z = Math.PI / 2;
      const holder = new Group();
      holder.add(wheel);
      const fairing = box(0.24, g.wheelRadius * 1.3, g.wheelRadius * 2.6, g.steer ? white : orange, 0, g.wheelRadius * 0.3, 0);
      holder.add(fairing);
      holder.position.set(g.pos[0], 0, g.pos[2]);
      const leg = new Mesh(new CylinderGeometry(0.04, 0.05, 1, 6), metal);
      leg.position.set(g.pos[0], 0, g.pos[2]);
      r.add(holder, leg);
      this.wheels.push({ mesh: holder, leg, attachY: g.pos[1], length: g.length, radius: g.wheelRadius });
    }

    r.traverse((o) => {
      if ((o as Mesh).isMesh && o !== this.propDisc) o.castShadow = true;
    });
  }

  update(pos: Vector3, q: Quaternion, c: Controls, sim: AircraftSim, dt: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    // control surfaces (see sign notes in docs: + rotation.x = trailing edge down)
    this.aileronL.rotation.x = c.roll * 18 * DEG;
    this.aileronR.rotation.x = -c.roll * 18 * DEG;
    this.elevator.rotation.x = -(c.pitch + c.trim * 0.3) * 24 * DEG;
    this.rudder.rotation.y = c.yaw * 25 * DEG;
    this.flapL.rotation.x = this.flapR.rotation.x = sim.flaps * 32 * DEG;
    // propeller: blades blur into a disc as rpm rises
    this.propAngle += (sim.rpm / 60) * Math.PI * 2 * dt;
    this.propBlades.rotation.z = this.propAngle;
    const blur = Math.min(1, Math.max(0, (sim.rpm - 500) / 900));
    this.propBlades.visible = blur < 0.95;
    (this.propDisc.material as MeshStandardMaterial).opacity = blur * 0.28;
    // wheels follow strut compression
    sim.wheels.forEach((w, i) => {
      const v = this.wheels[i];
      const extension = v.length - (w.contact ? w.compression : 0);
      const centreY = v.attachY - extension + v.radius;
      v.mesh.position.y = centreY;
      v.leg.scale.y = Math.max(0.05, extension - v.radius + 0.1);
      v.leg.position.y = v.attachY - (extension - v.radius) / 2;
    });
  }
}
