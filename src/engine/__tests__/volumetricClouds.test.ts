import { describe, expect, it } from "vitest";
import { cloudNoise3D, logDepthToViewZ, slabInterval, weatherMap2D } from "../volumetricClouds";

describe("volumetric clouds", () => {
  it("3D noise tiles on every axis and uses the full range", () => {
    const n = 16;
    const v = cloudNoise3D(n);
    const at = (x: number, y: number, z: number, c: number) => v[((z * n + y) * n + x) * 2 + c];
    // neighbours across a wrap edge differ about as much as neighbours inside the volume
    let edge = 0, inner = 0;
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        edge += Math.abs(at(n - 1, a, b, 0) - at(0, a, b, 0)) + Math.abs(at(a, b, n - 1, 1) - at(a, b, 0, 1));
        inner += Math.abs(at(n / 2 - 1, a, b, 0) - at(n / 2, a, b, 0)) + Math.abs(at(a, b, n / 2 - 1, 1) - at(a, b, n / 2, 1));
      }
    expect(edge).toBeLessThan(inner * 1.6 + n * n);
    const base = Array.from({ length: v.length / 2 }, (_, i) => v[i * 2]);
    expect(Math.max(...base)).toBeGreaterThan(200);
    expect(Math.min(...base)).toBeLessThan(40);
  });

  it("is deterministic", () => {
    expect(cloudNoise3D(8, 4)).toEqual(cloudNoise3D(8, 4));
    expect(weatherMap2D(32, 2)).toEqual(weatherMap2D(32, 2));
  });

  it("weather map: coverage threshold scales how much sky is cloudy", () => {
    const m = weatherMap2D(128);
    const presence = Array.from({ length: m.length / 2 }, (_, i) => m[i * 2] / 255);
    const frac = (cov: number) => presence.filter((p) => p > 1 - cov).length / presence.length;
    expect(frac(0.1)).toBeCloseTo(0.1, 1);
    expect(frac(0.35)).toBeGreaterThan(frac(0.1));
    expect(frac(0.66)).toBeCloseTo(0.66, 1);
  });

  it("decodes three.js logarithmic depth", () => {
    const far = 80000;
    for (const w of [0.5, 12, 950, 31000]) {
      const d = Math.log2(1 + w) / Math.log2(far + 1);
      expect(logDepthToViewZ(d, far)).toBeCloseTo(w, 3);
    }
  });

  it("finds the cloud slab along a ray", () => {
    // below, looking up 30°: enters at 1150 m, leaves at 3400 m
    const s = Math.sin(Math.PI / 6);
    const [t0, t1] = slabInterval(0, s, 1150, 3400, 1e9)!;
    expect(t0).toBeCloseTo(2300, 3);
    expect(t1).toBeCloseTo(6800, 3);
    // inside the slab: starts at the camera
    expect(slabInterval(2000, -0.2, 1150, 3400, 1e9)![0]).toBe(0);
    // below, looking down: no clouds
    expect(slabInterval(500, -0.1, 1150, 3400, 1e9)).toBeNull();
    // level flight below the slab: none; inside: up to the max distance
    expect(slabInterval(500, 0, 1150, 3400, 45000)).toBeNull();
    expect(slabInterval(1500, 0, 1150, 3400, 45000)).toEqual([0, 45000]);
  });
});
