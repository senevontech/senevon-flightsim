/* International Standard Atmosphere (troposphere) + simple deterministic wind/turbulence. */
import { Vector3 } from "three";

export const RHO0 = 1.225;

export interface AtmosphereSample {
  /** kg/m³ */
  density: number;
  /** K */
  temperature: number;
  /** Pa */
  pressure: number;
}

export function atmosphere(altitude: number, tempOffset = 0): AtmosphereSample {
  const h = Math.min(Math.max(altitude, -500), 11000);
  const T = 288.15 - 0.0065 * h + tempOffset;
  const p = 101325 * Math.pow(1 - 0.0065 * h / 288.15, 5.25588);
  return { density: p / (287.05 * T), temperature: T, pressure: p };
}

export interface WindSettings {
  /** Direction the wind blows FROM, degrees true (0 = north). */
  fromDeg: number;
  /** Steady wind speed at 300 m AGL and above (m/s). Reduced near the ground. */
  speed: number;
  /** Gust amplitude (m/s). */
  gust: number;
  /** Turbulence intensity 0..1. */
  turbulence: number;
}

export const calmWind = (): WindSettings => ({ fromDeg: 0, speed: 0, gust: 0, turbulence: 0 });

/** Smooth pseudo-noise from summed incommensurate sines: deterministic for replays. */
function smoothNoise(t: number, seed: number): number {
  return (
    Math.sin(t * 0.31 + seed) * 0.5 +
    Math.sin(t * 0.73 + seed * 1.7) * 0.3 +
    Math.sin(t * 1.93 + seed * 2.3) * 0.2
  );
}

/** Wind velocity (world frame, m/s, the direction air moves) at a point and time. */
export function windAt(w: WindSettings, pos: Vector3, agl: number, time: number, out = new Vector3()): Vector3 {
  // world: −Z = north, +X = east. Wind from 0° (north) blows toward +Z (south).
  const a = w.fromDeg * Math.PI / 180;
  // boundary layer: about 60% of the wind at the surface, full above 300 m
  const shear = 0.6 + 0.4 * Math.min(Math.max(agl, 0) / 300, 1);
  const gust = w.gust * (0.5 + 0.5 * smoothNoise(time * 0.6, 1.3));
  const s = (w.speed + gust) * shear;
  out.set(-Math.sin(a) * s, 0, Math.cos(a) * s);
  if (w.turbulence > 0) {
    const k = w.turbulence * 2.5 * Math.min(1, 0.3 + agl / 200);
    const px = pos.x * 0.004, pz = pos.z * 0.004;
    out.x += k * smoothNoise(time * 2.1 + px, 4.1);
    out.y += k * 0.6 * smoothNoise(time * 2.7 + pz, 7.9);
    out.z += k * smoothNoise(time * 2.3 + px + pz, 2.2);
  }
  return out;
}
