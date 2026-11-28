/* Six-degree-of-freedom rigid-body aircraft. Fixed timestep (call step(1/120)).
   Forces per lifting surface + fuselage drag + propeller + spring-damper landing gear.
   Body frame: +X right, +Y up, −Z forward. World: +X east, +Y up, −Z north. */
import { Quaternion, Vector3 } from "three";
import { atmosphere, calmWind, RHO0, windAt, type WindSettings } from "./atmosphere";
import { groundEffect, liftSlope, surfaceCoefs } from "./aero";
import { DEG, G, KT, type AircraftConfig, type Controls, type EngineConfig, type GearConfig, type SurfaceConfig } from "./types";
import { SURFACES, type WorldProvider } from "../world/WorldProvider";

export const SIM_DT = 1 / 120;
/** Propeller disc area (m²) used for the slipstream: ~1.9 m diameter. */
const PROP_DISC = 2.8;

interface SurfaceRT {
  cfg: SurfaceConfig;
  r: Vector3;
  fwd: Vector3;
  span: Vector3;
  normal: Vector3;
  slope: number;
  induced: number;
  isWing: boolean;
  /** Latest angle of attack (rad) and stall fraction, for HUD/assists. */
  alpha: number;
  stall: number;
}

export interface WheelState {
  cfg: GearConfig;
  r: Vector3;
  contact: boolean;
  compression: number;
  /** Normal force (N). */
  load: number;
  main: boolean;
}

export interface SpawnState {
  pos: Vector3;
  headingDeg: number;
  /** True airspeed along the nose (m/s). */
  speed: number;
  pitchDeg?: number;
  /** Flight path angle (deg), + = climbing. Defaults to 0. */
  pathDeg?: number;
  throttle?: number;
  flaps?: number;
  trim?: number;
  /** Gear position at spawn (1 = down). */
  gear?: number;
}

/** In-flight failures (Mayday scenarios). Cleared by reset(), kept by rewind. */
export interface Failures {
  engine: "ok" | "rough" | "dead";
  /** Extra fuel loss (kg/s). */
  fuelLeak: number;
  flapsJammed: boolean;
  /** Electrical failure: the sim flies on; the HUD loses its instruments. */
  electrical: boolean;
}
export const noFailures = (): Failures => ({ engine: "ok", fuelLeak: 0, flapsJammed: false, electrical: false });

export type CrashReason = "terrain" | "wingtip" | "propeller" | "tail" | "gear" | "overstress" | "overspeed" | "water" | "belly";

/** Float hull on water: high drag while ploughing (the "hump" near 15 kt), much less once it
    planes on the step; the keel gives some sideways grip. */
function waterHull(v: number): { rolling: number; grip: number } {
  // peak "hump" drag ≈ a fifth of the weight (full power gets through it); planing ≈ 7 %
  const hump = Math.exp(-(((v - 8) / 5) ** 2));
  return { rolling: v > 16 ? 0.08 : 0.06 + 0.13 * hump, grip: 0.35 };
}

// scratch vectors (no per-step allocation)
const vBody = new Vector3();
const vS = new Vector3();
const tmp = new Vector3();
const tmp2 = new Vector3();
const forceB = new Vector3();
const torqueB = new Vector3();
const forceW = new Vector3();
const qInv = new Quaternion();
const dq = new Quaternion();
const windW = new Vector3();
const UP = new Vector3(0, 1, 0);

export class AircraftSim {
  readonly cfg: AircraftConfig;
  readonly world: WorldProvider;
  wind: WindSettings = calmWind();

  // state
  pos = new Vector3();
  vel = new Vector3();
  q = new Quaternion();
  /** Angular velocity, body frame (rad/s). */
  w = new Vector3();
  fuel = 0;
  flaps = 0;
  rpm = 0;
  time = 0;
  crashed: CrashReason | null = null;
  failures: Failures = noFailures();

  // outputs (updated every step)
  readonly surfaces: SurfaceRT[];
  readonly wheels: WheelState[];
  thrust = 0;
  /** Indicated airspeed (m/s). */
  ias = 0;
  tas = 0;
  /** Aircraft angle of attack and sideslip (rad). */
  aoa = 0;
  beta = 0;
  /** Average wing AoA (rad) and stall fraction 0..1. */
  wingAoa = 0;
  wingStall = 0;
  /** Normal load factor (g). */
  gLoad = 1;
  /** Height of the wheels above the ground (m). */
  agl = 0;
  onGround = false;
  readonly windVel = new Vector3();
  /** Velocity at the end of the previous step (for touchdown vertical speed). */
  readonly prevVel = new Vector3();

  /** Actual control-surface positions (lag the pilot's input by the linkage rate). */
  readonly surfacePos = { pitch: 0, roll: 0, yaw: 0 };
  /** All engines (a single-engine config is normalised to a list of one). */
  readonly engines: EngineConfig[];
  /** Per-engine spool 0..1 (how much of full power it is producing) and thrust (N). */
  readonly spool: number[];
  readonly engineThrust: number[];
  /** Landing gear position: 1 = down and locked, 0 = up. Always 1 for fixed gear. */
  gearDown = 1;
  readonly hasFloats: boolean;
  private mass: number;
  private gearHeight: number;

  constructor(cfg: AircraftConfig, world: WorldProvider) {
    this.cfg = cfg;
    this.world = world;
    this.mass = cfg.mass;
    this.surfaces = cfg.surfaces.map((s) => {
      const span = s.kind === "vertical" ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      if (s.kind === "horizontal" && s.dihedral) {
        // span vector always points toward +X; the left wing (x < 0) tilts the other way
        const d = s.dihedral * DEG * (s.pos[0] < 0 ? -1 : 1);
        span.set(Math.cos(d), Math.sin(d), 0);
      }
      const fwd = new Vector3(0, 0, -1);
      const normal = new Vector3().crossVectors(span, fwd).normalize();
      return {
        cfg: s,
        r: new Vector3(...s.pos),
        fwd,
        span,
        normal,
        slope: liftSlope(s.aspect),
        induced: 1 / (Math.PI * s.e * s.aspect),
        isWing: !s.downwash && s.kind === "horizontal" && !!s.flap,
        alpha: 0,
        stall: 0,
      };
    });
    this.wheels = cfg.gear.map((g) => ({
      cfg: g,
      r: new Vector3(...g.pos),
      contact: false,
      compression: 0,
      load: 0,
      main: !g.steer,
    }));
    this.gearHeight = Math.max(...cfg.gear.map((g) => g.length - g.pos[1]));
    this.fuel = cfg.fuelCapacity * 0.6;
    this.engines = cfg.engines ?? (cfg.engine ? [cfg.engine] : []);
    this.spool = this.engines.map(() => 0);
    this.engineThrust = this.engines.map(() => 0);
    this.hasFloats = cfg.gear.some((g) => g.kind === "float");
  }

  /** Height of the CG above the ground when resting on its wheels (approx.). */
  get restHeight(): number {
    return this.gearHeight - 0.08;
  }

  reset(s: SpawnState): void {
    const heading = s.headingDeg * DEG;
    const pitch = (s.pitchDeg ?? 0) * DEG;
    const path = (s.pathDeg ?? 0) * DEG;
    this.pos.copy(s.pos);
    // yaw about +Y: heading 0 = north (−Z); heading increases clockwise (toward east, +X)
    this.q.setFromAxisAngle(UP, -heading);
    dq.setFromAxisAngle(tmp.set(1, 0, 0), pitch);
    this.q.multiply(dq);
    const dir = tmp.set(Math.sin(heading) * Math.cos(path), Math.sin(path), -Math.cos(heading) * Math.cos(path));
    this.vel.copy(dir).multiplyScalar(s.speed);
    // airborne starts move with the air mass: `speed` is airspeed along the heading. Spawning
    // with ground speed along the heading instead meant a sudden sideslip in any crosswind, and
    // the aircraft swung 6–8° into the wind on its own a few seconds after every spawn.
    const agl = this.pos.y - this.world.heightAt(this.pos.x, this.pos.z);
    if (s.speed > 0 && agl > 3) {
      windAt(this.wind, this.pos, agl, 0, windW);
      this.vel.add(windW);
    }
    this.prevVel.copy(this.vel);
    this.w.set(0, 0, 0);
    this.flaps = s.flaps ?? 0;
    const e0 = this.engines[0];
    this.rpm = s.throttle ? e0.idleRpm + (e0.maxRpm - e0.idleRpm) * Math.sqrt(s.throttle) : e0.idleRpm;
    this.spool.fill(s.throttle ?? 0);
    this.engineThrust.fill(0);
    this.gearDown = this.cfg.retractable ? (s.gear ?? 1) : 1;
    this.crashed = null;
    this.failures = noFailures();
    this.surfacePos.pitch = this.surfacePos.roll = this.surfacePos.yaw = 0;
    this.time = 0;
    this.fuel = this.cfg.fuelCapacity * 0.6;
    for (const wh of this.wheels) {
      wh.contact = false;
      wh.compression = 0;
      wh.load = 0;
    }
    this.updateOutputs();
  }

  /** Copy the full dynamic state (for rewind / interpolation). */
  snapshot() {
    return {
      pos: this.pos.clone(),
      vel: this.vel.clone(),
      q: this.q.clone(),
      w: this.w.clone(),
      fuel: this.fuel,
      surfaces: { ...this.surfacePos },
      thrust: this.thrust, // feeds next step's propwash: part of the state
      spool: [...this.spool],
      gearDown: this.gearDown,
      flaps: this.flaps,
      rpm: this.rpm,
      time: this.time,
    };
  }

  restore(s: ReturnType<AircraftSim["snapshot"]>): void {
    this.pos.copy(s.pos);
    this.vel.copy(s.vel);
    this.prevVel.copy(s.vel);
    this.q.copy(s.q);
    this.w.copy(s.w);
    this.fuel = s.fuel;
    Object.assign(this.surfacePos, s.surfaces);
    this.thrust = s.thrust;
    this.spool.splice(0, this.spool.length, ...s.spool);
    this.gearDown = s.gearDown;
    this.flaps = s.flaps;
    this.rpm = s.rpm;
    this.time = s.time;
    this.crashed = null;
  }

  step(dt: number, c: Controls): void {
    if (this.crashed) return;
    const cfg = this.cfg;
    this.prevVel.copy(this.vel);
    this.time += dt;

    const ground = this.world.heightAt(this.pos.x, this.pos.z);
    const cgAgl = this.pos.y - ground;
    const atm = atmosphere(this.pos.y);
    const rho = atm.density;
    windAt(this.wind, this.pos, cgAgl, this.time, windW);
    this.windVel.copy(windW);

    qInv.copy(this.q).invert();
    // velocity relative to the air, body frame
    vBody.copy(this.vel).sub(windW).applyQuaternion(qInv);
    const airspeed = vBody.length();

    // flaps actuator
    const flapRate = cfg.flaps.speed * dt;
    if (!this.failures.flapsJammed) this.flaps += Math.max(-flapRate, Math.min(flapRate, c.flaps - this.flaps));
    // control surfaces follow the pilot's input at the linkage rate (no instant snaps)
    const cr = (cfg.controlRate ?? 5) * dt;
    const sp = this.surfacePos;
    sp.pitch += Math.max(-cr, Math.min(cr, c.pitch - sp.pitch));
    sp.roll += Math.max(-cr, Math.min(cr, c.roll - sp.roll));
    sp.yaw += Math.max(-cr, Math.min(cr, c.yaw - sp.yaw));

    forceB.set(0, 0, 0);
    torqueB.set(0, 0, 0);

    // ---- lifting surfaces ----
    // wings first (their AoA drives downwash on the tail)
    let wingAlphaSum = 0, wingStallSum = 0, wingN = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.surfaces) {
        if ((pass === 0) !== s.isWing) continue;
        const sc = s.cfg;
        // velocity of the surface through the air (body)
        vS.crossVectors(this.w, s.r).add(vBody);
        // propeller slipstream over the tail (momentum theory): rudder and elevator bite at
        // low speed with power on, as in a real single
        if (sc.propwash && this.thrust > 0) {
          const v0 = Math.max(-vBody.z, 0);
          const wash = Math.sqrt(v0 * v0 + (2 * this.thrust) / (rho * PROP_DISC)) - v0;
          // the slipstream spreads and only covers part of the tail: about a quarter of the
          // fully developed wash velocity reaches it
          vS.addScaledVector(s.fwd, wash * 0.25);
        }
        vS.addScaledVector(s.span, -vS.dot(s.span));
        const V = vS.length();
        if (V < 0.3) continue;
        const vf = vS.dot(s.fwd);
        const vn = vS.dot(s.normal);
        let alpha = Math.atan2(-vn, vf) + (sc.incidence ?? 0) * DEG;
        if (sc.downwash && wingN) alpha -= sc.downwash * (wingAlphaSum / wingN);

        let cl0 = sc.cl0, clMax = sc.clMax, cd0 = sc.cd0;
        if (sc.flap) {
          cl0 += cfg.flaps.cl0Gain * this.flaps;
          clMax += cfg.flaps.clMaxGain * this.flaps;
          cd0 += cfg.flaps.cdGain * this.flaps;
        }
        // control surfaces / trim tabs change the section's camber: they shift CL and, like a
        // flap, most of the stall limit with it (a deflected elevator doesn't stall the tail early)
        let dCamber = 0;
        if (sc.control && sc.controlCL) {
          const sp = this.surfacePos;
          const input = sc.control === "elevator" ? sp.pitch : sc.control === "rudder" ? sp.yaw : sp.roll;
          dCamber += sc.controlCL * input;
        }
        if (sc.trimCL) dCamber += sc.trimCL * c.trim;
        const baseClMax = clMax;
        cl0 += dCamber;
        clMax += Math.max(0, dCamber) * 0.75;

        // ground effect (height of this surface above the ground)
        tmp.copy(s.r).applyQuaternion(this.q);
        const ge = groundEffect(this.pos.y + tmp.y - ground, sc.span ?? 0);
        const clMin = (sc.clMin ?? -0.75 * baseClMax) + Math.min(0, dCamber) * 0.75;
        const k = surfaceCoefs(alpha, s.slope, cl0, clMax * ge.lift, clMin, cd0, s.induced * ge.induced);
        s.alpha = alpha;
        s.stall = k.stall;
        if (s.isWing) {
          wingAlphaSum += alpha;
          wingStallSum += k.stall;
          wingN++;
        }

        const qS = 0.5 * rho * V * V * sc.area;
        // drag along the airflow, lift perpendicular to it and to the span
        const dragDir = tmp.copy(vS).multiplyScalar(-1 / V);
        const liftDir = tmp2.crossVectors(dragDir, s.span);
        const f = vS.copy(liftDir).multiplyScalar(k.cl * qS).addScaledVector(dragDir, k.cd * qS);
        forceB.add(f);
        torqueB.add(tmp.crossVectors(s.r, f));
      }
    }
    this.wingAoa = wingN ? wingAlphaSum / wingN : 0;
    this.wingStall = wingN ? wingStallSum / wingN : 0;

    // ---- fuselage drag ----
    if (airspeed > 0.1) {
      const gearDrag = cfg.retractable ? cfg.retractable.dragArea * this.gearDown : 0;
      const d = 0.5 * rho * airspeed * airspeed * (cfg.fuselageCdA + gearDrag);
      forceB.addScaledVector(vBody, -d / airspeed);
    }

    // ---- engines ----
    const sigma = rho / RHO0;
    const throttle = this.fuel > 0 ? Math.min(Math.max(c.throttle, 0), 1) : 0;
    const f = this.failures;
    const vFwd = Math.max(-vBody.z, 0);
    const single = this.engines.length === 1;
    let thrustSum = 0, rpmSum = 0, burn = 0;
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i];
      // a Mayday failure hits the only engine, or the left engine of a twin
      const failed = i === 0 || single ? f.engine : "ok";
      // spool toward the throttle (jets and turboprops lag; spooling down is quicker)
      const target = failed === "dead" ? 0 : throttle;
      const up = 1 / (e.spoolTime ?? 0.6), down = up * 2;
      this.spool[i] += Math.max(-down * dt, Math.min(up * dt, target - this.spool[i]));
      let level = this.spool[i];
      if (failed === "rough") level *= 0.55 + 0.2 * Math.sin(this.time * 7.3 + i) * Math.sin(this.time * 2.1 + 1);
      let T: number, power = 0;
      if (e.type === "jet") {
        // turbofan: idle thrust ~5 %, thrust lapse with density and a little with speed
        const run = failed === "dead" ? 0 : 0.05 + 0.95 * level;
        T = (e.thrust ?? 0) * run * Math.pow(sigma, 0.8) * (1 - Math.min(vFwd / 340, 0.6) * 0.35);
        burn += e.fuelBurn * Math.max(run, 0.06);
        rpmSum += failed === "dead" ? Math.min(vFwd * 0.6, 25) : 22 + 78 * level; // N1 %
      } else {
        power = e.power * level * Math.max(0, (sigma - 0.12) / 0.88);
        const powerFrac = power / e.power;
        T = Math.min(e.staticThrust * powerFrac, (e.efficiency * power) / Math.max(vFwd, 1));
        burn += e.fuelBurn * Math.max(powerFrac, failed === "dead" ? 0 : 0.05);
        let rpmT = failed !== "dead" && this.fuel > 0
          ? Math.min(e.maxRpm * 1.05, e.idleRpm + (e.maxRpm - e.idleRpm) * Math.pow(level, 0.6) + vFwd * 4)
          : vFwd * 18; // windmilling propeller
        if (failed === "rough") rpmT *= 0.75 + 0.12 * Math.sin(this.time * 7.3);
        rpmSum += rpmT;
        // single-engine torque reaction and P-factor (twins are handed to cancel them)
        if (single) {
          const omega = Math.max((this.rpm * 2 * Math.PI) / 60, 50);
          torqueB.z += (e.torqueFactor * power) / omega; // reaction rolls left
          torqueB.y += e.pFactor * T * Math.max(0, 1 - vFwd / 45); // slipstream / P-factor yaws left
        }
      }
      this.engineThrust[i] = T;
      thrustSum += T;
      // thrust acts at the engine: off-centre engines yaw the aircraft (asymmetric thrust)
      const fe = tmp.set(0, 0, -T);
      forceB.add(fe);
      torqueB.add(tmp2.set(e.pos[0], e.pos[1], e.pos[2]).cross(fe));
    }
    this.thrust = thrustSum;
    const rpmTarget = rpmSum / Math.max(1, this.engines.length);
    this.rpm += (rpmTarget - this.rpm) * Math.min(1, dt * 2.5);
    this.fuel = Math.max(0, this.fuel - (burn + f.fuelLeak) * dt);

    // ---- retractable gear ----
    if (cfg.retractable) {
      const rate = dt / cfg.retractable.time;
      this.gearDown += Math.max(-rate, Math.min(rate, (c.gear > 0.5 ? 1 : 0) - this.gearDown));
    }

    // ---- angular damping ----
    torqueB.x -= cfg.damping[0] * this.w.x;
    torqueB.y -= cfg.damping[1] * this.w.y;
    torqueB.z -= cfg.damping[2] * this.w.z;

    // aero + engine force → world
    forceW.copy(forceB).applyQuaternion(this.q);
    const totalMass = this.mass + this.fuel;
    // load factor from non-gravity forces (gear added below)
    const aeroUp = forceB.y;

    // ---- landing gear ----
    let anyContact = false;
    let gearUp = 0;
    for (const wh of this.wheels) {
      const g = wh.cfg;
      const attach = tmp.copy(wh.r).applyQuaternion(this.q).add(this.pos);
      const strut = tmp2.set(0, -1, 0).applyQuaternion(this.q);
      wh.contact = false;
      wh.load = 0;
      wh.compression = 0;
      if (strut.y > -0.3) continue; // upside down / on its side: no wheel contact
      const isFloat = g.kind === "float";
      if (!isFloat && this.gearDown < 0.95) continue; // wheels retracted (or in transit)
      const gh = this.world.heightAt(attach.x, attach.z);
      const dist = (attach.y - gh) / -strut.y;
      const comp = g.length - dist;
      if (comp <= 0) continue;
      const surfaceType = this.world.surfaceAt(attach.x, attach.z);
      const onWater = surfaceType === "water";
      if (!isFloat && onWater) {
        if (this.hasFloats) continue; // amphibian: on water the floats carry it, wheels stay dry
        this.crash("water"); // wheels in the sea: ditched
        return;
      }
      if (comp > g.length * 0.98 && !isFloat) {
        this.crash("gear");
        return;
      }
      const surface = isFloat
        ? onWater ? waterHull(vFwd) : SURFACES.grass // floats on land: skid on the keel
        : SURFACES[surfaceType];
      // velocity of the contact point (world)
      const rContact = vS.copy(wh.r);
      rContact.y -= dist;
      const pv = new Vector3().crossVectors(this.w, rContact).applyQuaternion(this.q).add(this.vel);
      const compRate = -pv.y;
      const N = Math.max(0, g.stiffness * comp + g.damping * compRate);
      wh.contact = true;
      wh.compression = comp;
      wh.load = N;
      anyContact = true;

      // tyre direction on the ground (nose wheel steers with rudder, less at speed)
      // + steer = wheel turned right (rudder right)
      // nose wheel ahead of the CG turns the way you steer; a water rudder behind the CG turns the
      // other way so the nose still swings toward the rudder pedal you press
      const steerSign = g.pos[2] > 0 ? -1 : 1;
      const steer = g.steer ? steerSign * g.steer * DEG * c.yaw * Math.max(0.15, 1 - vFwd / (30 * KT)) : 0;
      const fwdG = new Vector3(Math.sin(steer), 0, -Math.cos(steer)).applyQuaternion(this.q);
      fwdG.y = 0;
      fwdG.normalize();
      const rightG = new Vector3(-fwdG.z, 0, fwdG.x);
      const vLong = pv.dot(fwdG);
      const vLat = pv.dot(rightG);
      const mu = surface.rolling + (g.brakes && !isFloat ? c.brakes * 0.75 * surface.grip : 0);
      const fLong = -mu * N * Math.tanh(vLong / 0.25);
      const fLat = -surface.grip * N * Math.tanh(vLat / 0.25);
      const fw = new Vector3(0, N, 0).addScaledVector(fwdG, fLong).addScaledVector(rightG, fLat);
      forceW.add(fw);
      // torque about CG (body)
      const fb = fw.applyQuaternion(qInv);
      torqueB.add(new Vector3().crossVectors(rContact, fb));
      gearUp += fb.y;
    }
    this.onGround = anyContact;

    // gravity
    forceW.y -= totalMass * G;

    // ---- integrate (semi-implicit Euler) ----
    this.vel.addScaledVector(forceW, dt / totalMass);
    this.pos.addScaledVector(this.vel, dt);

    const [Ix, Iy, Iz] = cfg.inertia;
    const w = this.w;
    // gyroscopic term ω × (Iω)
    const gx = w.y * (Iz * w.z) - w.z * (Iy * w.y);
    const gy = w.z * (Ix * w.x) - w.x * (Iz * w.z);
    const gz = w.x * (Iy * w.y) - w.y * (Ix * w.x);
    w.x += ((torqueB.x - gx) / Ix) * dt;
    w.y += ((torqueB.y - gy) / Iy) * dt;
    w.z += ((torqueB.z - gz) / Iz) * dt;
    const wl = w.length();
    if (wl > 1e-9) {
      dq.setFromAxisAngle(tmp.copy(w).multiplyScalar(1 / wl), wl * dt);
      this.q.multiply(dq).normalize();
    }

    this.gLoad = (aeroUp + gearUp) / (totalMass * G);
    this.updateOutputs();
    this.checkCrash();
  }

  private updateOutputs(): void {
    qInv.copy(this.q).invert();
    vBody.copy(this.vel).sub(this.windVel).applyQuaternion(qInv);
    this.tas = vBody.length();
    this.ias = this.tas * Math.sqrt(atmosphere(this.pos.y).density / RHO0);
    this.aoa = Math.atan2(-vBody.y, -vBody.z);
    this.beta = Math.atan2(vBody.x, -vBody.z);
    this.agl = this.pos.y - this.world.heightAt(this.pos.x, this.pos.z) - this.gearHeight;
  }

  private checkCrash(): void {
    const cfg = this.cfg;
    for (let i = 0; i < cfg.crashPoints.length; i++) {
      const p = tmp.set(...cfg.crashPoints[i]).applyQuaternion(this.q).add(this.pos);
      if (p.y < this.world.heightAt(p.x, p.z)) {
        const cp = cfg.crashPoints[i];
        // gear up and arriving roughly wings-level: whatever touches first, it's a belly landing
        const belly = this.gearDown < 0.9 && !this.hasFloats && Math.abs(this.bankDeg) < 12 && this.pitchDeg > -10 && this.pitchDeg < 15;
        this.crash(belly ? "belly" : Math.abs(cp[0]) > 2 ? "wingtip" : cp[2] < -1 ? "propeller" : cp[2] > 2 ? "tail" : "terrain");
        return;
      }
    }
    if (this.gLoad > cfg.limits.gMax * 1.5 || this.gLoad < cfg.limits.gMin * 1.5) this.crash("overstress");
    else if (this.ias > cfg.limits.vne * KT * 1.25) this.crash("overspeed");
  }

  private crash(reason: CrashReason): void {
    this.crashed = reason;
    this.vel.set(0, 0, 0);
    this.w.set(0, 0, 0);
  }

  // ---- convenience getters (world-frame attitude) ----

  /** Heading of the nose, degrees 0..360 (0 = north). */
  get headingDeg(): number {
    const f = tmp.set(0, 0, -1).applyQuaternion(this.q);
    const h = Math.atan2(f.x, -f.z) / DEG;
    return (h + 360) % 360;
  }

  /** Pitch of the nose above the horizon (deg). */
  get pitchDeg(): number {
    const f = tmp.set(0, 0, -1).applyQuaternion(this.q);
    return Math.asin(Math.max(-1, Math.min(1, f.y))) / DEG;
  }

  /** Bank angle (deg), + = right wing down. */
  get bankDeg(): number {
    const r = tmp.set(1, 0, 0).applyQuaternion(this.q);
    const u = tmp2.set(0, 1, 0).applyQuaternion(this.q);
    return Math.atan2(-r.y, u.y) / DEG;
  }

  /** Vertical speed (m/s). */
  get vs(): number {
    return this.vel.y;
  }

  /** Ground track (deg) — direction of travel over the ground. */
  get trackDeg(): number {
    return ((Math.atan2(this.vel.x, -this.vel.z) / DEG) + 360) % 360;
  }

  get groundSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}
