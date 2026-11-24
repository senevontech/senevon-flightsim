/* Lift and drag coefficients for one lifting surface, valid for any angle of attack
   (linear range → soft stall → flat-plate behaviour, including reverse flow). */

const STALL_BAND = 8 * Math.PI / 180;

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}

export interface Coefs {
  cl: number;
  cd: number;
  /** 0 = attached flow, 1 = fully stalled. */
  stall: number;
}

/**
 * @param alpha angle of attack (rad), any value in (−π, π]
 * @param slope lift-curve slope (per rad)
 * @param cl0 CL at α = 0 (after flaps/controls)
 * @param clMax positive stall CL; clMin negative stall CL (negative number)
 * @param induced induced drag factor 1/(π·e·AR), already scaled for ground effect
 */
export function surfaceCoefs(alpha: number, slope: number, cl0: number, clMax: number, clMin: number, cd0: number, induced: number): Coefs {
  const aPos = (clMax - cl0) / slope;
  const aNeg = (clMin - cl0) / slope;
  const lin = Math.min(Math.max(cl0 + slope * alpha, clMin), clMax);
  let stall = 0;
  if (alpha > aPos) stall = smooth01((alpha - aPos) / STALL_BAND);
  else if (alpha < aNeg) stall = smooth01((aNeg - alpha) / STALL_BAND);
  const s = Math.sin(alpha);
  const flatCl = 0.9 * Math.sin(2 * alpha);
  const flatCd = 1.28 * s * s + cd0;
  const attachedCd = cd0 + lin * lin * induced;
  return {
    cl: lin + (flatCl - lin) * stall,
    cd: attachedCd + (flatCd - attachedCd) * stall,
    stall,
  };
}

/** Lift-curve slope for a finite wing (per rad). */
export const liftSlope = (aspect: number): number => 2 * Math.PI * aspect / (aspect + 2);

/** Ground effect: induced-drag multiplier (≤ 1) and lift multiplier (≥ 1) at height h for span b. */
export function groundEffect(h: number, b: number): { induced: number; lift: number } {
  if (!b || h >= b || h < 0) return { induced: 1, lift: 1 };
  const r = (16 * h / b) ** 2;
  return { induced: r / (1 + r), lift: 1 + 0.12 * (1 - h / b) };
}
