/* Chase camera (lagged, mouse orbit + wheel zoom) and cockpit camera (mouse look). */
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { AircraftConfig } from "../sim/types";

export type CameraMode = "chase" | "cockpit" | "wing" | "tower" | "flyby";
const MODES: CameraMode[] = ["chase", "cockpit", "wing", "tower", "flyby"];
export const CAMERA_NAMES: Record<CameraMode, string> = {
  chase: "Chase camera", cockpit: "Cockpit", wing: "Wing view", tower: "Tower view", flyby: "Fly-by",
};

const UP = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const look = new Vector3();

export class CameraRig {
  readonly camera = new PerspectiveCamera(60, 1, 0.1, 80000);
  mode: CameraMode = "chase";
  private camQ = new Quaternion();
  private orbitYaw = 0;
  private orbitPitch = 0;
  private zoom = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private initialised = false;

  /** When false (mouse flying), only the right button orbits / looks around. */
  leftButtonOrbits = true;
  /** Context for the tower / fly-by cameras (set by the game). */
  ground: (x: number, z: number) => number = () => 0;
  towerPos = new Vector3();
  velocity = new Vector3();
  private flyPos: Vector3 | null = null;
  /** 0..1 camera shake (turbulence, runway roll, engine); set every frame by the game. */
  shake = 0;
  private shakeT = 0;

  constructor(public cfg: AircraftConfig, el: HTMLElement) {
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("pointerdown", (e) => {
      if (e.button === 0 && !this.leftButtonOrbits) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("pointerup", () => (this.dragging = false));
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.orbitYaw -= (e.clientX - this.lastX) * 0.006;
      this.orbitPitch = Math.max(-1.2, Math.min(1.2, this.orbitPitch - (e.clientY - this.lastY) * 0.005));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    el.addEventListener("dblclick", () => this.resetView());
    el.addEventListener("wheel", (e) => {
      this.zoom = Math.max(0.45, Math.min(4, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
    }, { passive: true });
  }

  resetView(): void {
    this.orbitYaw = 0;
    this.orbitPitch = 0;
  }

  /** Next camera; returns its display name. */
  toggle(): string {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.resetView();
    this.flyPos = null;
    this.applyFov();
    return CAMERA_NAMES[this.mode];
  }

  snap(): void {
    this.initialised = false;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.applyFov();
  }

  /** Vertical field of view for the mode. On tall (portrait) screens it widens so the view
      keeps at least the side-to-side angle a 6:5 screen would show. */
  private applyFov(): void {
    const base = this.mode === "cockpit" ? 72 : this.mode === "wing" ? 70 : 60;
    const minAspect = 1.2, a = this.camera.aspect;
    let fov = base;
    if (a < minAspect) {
      const half = Math.atan(Math.tan((base * Math.PI) / 360) * minAspect / a);
      fov = Math.min(100, (half * 360) / Math.PI);
    }
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  update(pos: Vector3, q: Quaternion, dt: number, groundY: number): void {
    this.place(pos, q, dt, groundY);
    // a gentle sway, not a vibration: low frequencies (1–3 Hz), cockpit only for the small
    // stuff; the chase view only moves on real bumps (turbulence, hard landings)
    if (this.shake > 0.02 && this.mode !== "tower" && this.mode !== "flyby") {
      this.shakeT += dt;
      const t = this.shakeT, k = this.shake * (this.mode === "cockpit" ? 0.0025 : 0.0012);
      this.camera.rotateX(k * (Math.sin(t * 9.1) + 0.5 * Math.sin(t * 15.7)));
      this.camera.rotateY(k * 0.4 * Math.sin(t * 7.3 + 1.3));
      this.camera.rotateZ(k * 0.6 * Math.sin(t * 6.1 + 0.7));
    }
  }

  private place(pos: Vector3, q: Quaternion, dt: number, groundY: number): void {
    const cam = this.camera;
    // let the orbit drift back behind the aircraft when not dragging
    if (!this.dragging) {
      const k = 1 - Math.exp(-dt * 0.6);
      this.orbitYaw -= this.orbitYaw * k;
      this.orbitPitch -= this.orbitPitch * k;
    }
    const orbit = tmpQ.setFromAxisAngle(UP, this.orbitYaw);
    const orbitPitch = new Quaternion().setFromAxisAngle(tmpV.set(1, 0, 0), this.orbitPitch);

    if (this.mode === "cockpit" || this.mode === "wing") {
      const eye = this.mode === "cockpit" ? this.cfg.cameras.cockpit : ([-4.7, 1.35, 0.9] as const);
      cam.position.copy(tmpV.set(eye[0], eye[1], eye[2]).applyQuaternion(q).add(pos));
      cam.quaternion.copy(q);
      if (this.mode === "wing") cam.quaternion.multiply(new Quaternion().setFromAxisAngle(UP, -0.22));
      cam.quaternion.multiply(orbit).multiply(orbitPitch);
      cam.up.copy(UP).applyQuaternion(q);
      return;
    }

    if (this.mode === "tower" || this.mode === "flyby") {
      if (this.mode === "tower") cam.position.copy(this.towerPos);
      else {
        // park the camera ahead of the aircraft, beside its path; re-place once it has passed
        const ahead = this.flyPos ? tmpV.copy(this.flyPos).sub(pos).dot(this.velocity) : -1;
        if (!this.flyPos || ahead < 0 || this.flyPos.distanceTo(pos) > 900) {
          const dir = this.velocity.lengthSq() > 4 ? this.velocity.clone().normalize() : new Vector3(0, 0, -1).applyQuaternion(q);
          const side = new Vector3(-dir.z, 0, dir.x).normalize();
          this.flyPos = pos.clone().addScaledVector(dir, Math.max(250, this.velocity.length() * 6)).addScaledVector(side, 28);
          this.flyPos.y = Math.max(this.flyPos.y + 4, this.ground(this.flyPos.x, this.flyPos.z) + 3);
        }
        cam.position.copy(this.flyPos);
      }
      cam.up.copy(UP);
      cam.lookAt(pos);
      // zoom so the aircraft stays a similar size
      const fov = Math.max(3, Math.min(60, (2 * Math.atan(14 / cam.position.distanceTo(pos)) * 180) / Math.PI));
      if (Math.abs(fov - cam.fov) > 0.2) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      return;
    }

    // chase: follow the aircraft's orientation with lag; keep the horizon mostly level
    if (!this.initialised) {
      this.camQ.copy(q);
      this.initialised = true;
    } else this.camQ.slerp(q, 1 - Math.exp(-dt * 4.5));
    const [ox, oy, oz] = this.cfg.cameras.chase;
    const offset = tmpV.set(ox, oy, oz * this.zoom).applyQuaternion(orbitPitch).applyQuaternion(orbit).applyQuaternion(this.camQ);
    cam.position.copy(pos).add(offset);
    cam.position.y = Math.max(cam.position.y, groundY + 0.6);
    const bodyUp = new Vector3(0, 1, 0).applyQuaternion(this.camQ);
    cam.up.copy(UP).lerp(bodyUp, 0.35).normalize();
    look.set(0, 0.8, -8).applyQuaternion(this.camQ).add(pos);
    cam.lookAt(look);
  }
}
