/* All world access goes through this interface, so the procedural world (Phase 1) and the
   real-world 3D Tiles world (later) are interchangeable. World frame: +X east, +Y up, −Z north. */

export type SurfaceType = "asphalt" | "grass" | "dirt" | "water";

export interface SurfaceProps {
  /** Rolling resistance coefficient. */
  rolling: number;
  /** Max lateral/braking friction coefficient. */
  grip: number;
}

export const SURFACES: Record<SurfaceType, SurfaceProps> = {
  asphalt: { rolling: 0.015, grip: 0.8 },
  grass: { rolling: 0.05, grip: 0.55 },
  dirt: { rolling: 0.04, grip: 0.6 },
  water: { rolling: 0.3, grip: 0.1 },
};

export interface Runway {
  id: string;
  /** Designator at the threshold you land on, e.g. "36". */
  name: string;
  /** Threshold centre (world). */
  threshold: { x: number; y: number; z: number };
  /** Landing direction, degrees true (0 = north). */
  headingDeg: number;
  length: number;
  width: number;
  /** Aim point distance past the threshold (m). */
  aimPoint: number;
  surface?: SurfaceType;
}

/** Both landing directions of one physical runway. `center` is the runway's midpoint. */
export function runwayPair(
  center: { x: number; z: number }, elevation: number, headingDeg: number, length: number, width: number,
  surface: SurfaceType = "asphalt",
): [Runway, Runway] {
  const mk = (hdg: number): Runway => {
    const h = hdg * Math.PI / 180;
    const fx = Math.sin(h), fz = -Math.cos(h);
    const num = Math.round(hdg / 10) % 36 || 36;
    return {
      id: String(num).padStart(2, "0"),
      name: String(num).padStart(2, "0"),
      threshold: { x: center.x - fx * length / 2, y: elevation, z: center.z - fz * length / 2 },
      headingDeg: hdg,
      length,
      width,
      aimPoint: Math.min(300, length * 0.22),
      surface,
    };
  };
  return [mk(headingDeg % 360), mk((headingDeg + 180) % 360)];
}

export interface Airport {
  id: string;
  name: string;
  elevation: number;
  runways: Runway[];
}

export interface WorldProvider {
  /** Ground (or water surface) height at x, z. */
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): SurfaceType;
  airports(): Airport[];
}

/** Runway-relative coordinates: along = metres past the threshold, cross = metres right of centreline. */
export function runwayCoords(rwy: Runway, x: number, z: number): { along: number; cross: number } {
  const h = rwy.headingDeg * Math.PI / 180;
  const fx = Math.sin(h), fz = -Math.cos(h); // forward (landing direction)
  const rx = Math.cos(h), rz = Math.sin(h); // right of centreline
  const dx = x - rwy.threshold.x, dz = z - rwy.threshold.z;
  return { along: dx * fx + dz * fz, cross: dx * rx + dz * rz };
}

export function onRunway(rwy: Runway, x: number, z: number): boolean {
  const c = runwayCoords(rwy, x, z);
  return c.along >= -5 && c.along <= rwy.length + 5 && Math.abs(c.cross) <= rwy.width / 2;
}
