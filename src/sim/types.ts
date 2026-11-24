/* Aircraft config (data-driven flight model). SI units: kg, m, N, W, m/s. Angles in degrees.
   Body frame (same as Three.js objects): +X right, +Y up, −Z forward (nose). Origin = centre of
   gravity. See docs/FLIGHT_MODEL.md. */

export type Vec3Tuple = [number, number, number];

export type ControlChannel = "aileronL" | "aileronR" | "elevator" | "rudder";

export interface SurfaceConfig {
  name: string;
  /** "horizontal": span along X (wings, tail). "vertical": span along Y (fin). */
  kind: "horizontal" | "vertical";
  /** Aerodynamic centre, body frame. */
  pos: Vec3Tuple;
  area: number;
  /** Aspect ratio used for lift slope and induced drag (whole wing for wing halves). */
  aspect: number;
  /** Full wingspan (for ground effect); 0 = no ground effect. */
  span?: number;
  incidence?: number;
  dihedral?: number;
  cl0: number;
  clMax: number;
  /** Most negative CL before negative stall (default −0.75 × clMax). */
  clMin?: number;
  cd0: number;
  /** Oswald efficiency. */
  e: number;
  control?: ControlChannel;
  /** ΔCL at full control deflection (sign included). */
  controlCL?: number;
  /** Trim tab effect: ΔCL at full trim (elevator only). */
  trimCL?: number;
  flap?: boolean;
  /** Fraction of the wing's angle of attack removed by downwash (tail surfaces). */
  downwash?: number;
  /** Surface sits in the propeller slipstream (tail surfaces): extra airflow with power on. */
  propwash?: boolean;
}

export interface EngineConfig {
  type: "piston";
  /** Max shaft power at sea level (W). */
  power: number;
  /** Propeller efficiency in cruise. */
  efficiency: number;
  /** Max static thrust (N). */
  staticThrust: number;
  idleRpm: number;
  maxRpm: number;
  /** Engine torque reaction scale (roll), N·m per W/rad-s. 0 = none. */
  torqueFactor: number;
  /** Slipstream / P-factor yaw: metres of moment arm per N of thrust at low speed. */
  pFactor: number;
  /** Fuel burn at full power (kg/s). */
  fuelBurn: number;
  /** Thrust line position (body). */
  pos: Vec3Tuple;
}

export interface GearConfig {
  name: string;
  /** Strut attach point, body frame. The wheel hangs below it along −Y body. */
  pos: Vec3Tuple;
  /** Distance from attach point to the bottom of the tyre at full extension. */
  length: number;
  stiffness: number;
  damping: number;
  /** Nose-wheel steering angle at full rudder (deg). 0 = fixed. */
  steer?: number;
  brakes?: boolean;
  wheelRadius: number;
}

export interface AircraftConfig {
  id: string;
  name: string;
  /** Mass as flown (empty + pilot); fuel is added on top. */
  mass: number;
  fuelCapacity: number;
  /** Principal moments of inertia: [pitch (X), yaw (Y), roll (Z)]. */
  inertia: Vec3Tuple;
  /** Extra angular damping, N·m per rad/s: [pitch, yaw, roll]. */
  damping: Vec3Tuple;
  /** Fuselage drag area Cd·A (m²) acting at the CG. */
  fuselageCdA: number;
  surfaces: SurfaceConfig[];
  engine: EngineConfig;
  gear: GearConfig[];
  /** Points that must never touch the ground (wingtips, tail, nose, prop). Body frame. */
  crashPoints: Vec3Tuple[];
  flaps: { steps: number[]; clMaxGain: number; cl0Gain: number; cdGain: number; speed: number; vfe: number };
  limits: { vne: number; gMax: number; gMin: number };
  /** Reference speeds (knots) for HUD/assists/briefings. */
  speeds: { vs0: number; vs1: number; vr: number; vy: number; vapp: number; vcruise: number };
  cameras: { cockpit: Vec3Tuple; chase: Vec3Tuple };
  /** Control-surface travel rate (full deflection per second), like a real control linkage. */
  controlRate?: number;
}

/** Pilot controls after input mapping + assists. Axes −1..1, throttle/flaps/brakes 0..1. */
export interface Controls {
  /** + = nose up (pull). */
  pitch: number;
  /** + = roll right. */
  roll: number;
  /** + = yaw right. */
  yaw: number;
  throttle: number;
  /** Flap lever target 0..1. */
  flaps: number;
  brakes: number;
  /** Elevator trim −1..1, + = nose up. */
  trim: number;
}

export const emptyControls = (): Controls => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0, flaps: 0, brakes: 0, trim: 0 });

export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const FPM = 0.00508; // m/s per ft/min
export const G = 9.80665;
export const DEG = Math.PI / 180;
