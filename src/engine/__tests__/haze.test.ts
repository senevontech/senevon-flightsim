import { describe, expect, it } from "vitest";
import { hazeDensity, hazeFactor } from "../haze";

describe("aerial perspective (height haze)", () => {
  const d = hazeDensity(55);

  it("horizontal sea-level haze grows with distance and is strong near the visibility limit", () => {
    expect(hazeFactor(d, 0, 0, 1000)).toBeLessThan(0.06);
    expect(hazeFactor(d, 0, 0, 10000)).toBeGreaterThan(hazeFactor(d, 0, 0, 5000));
    expect(hazeFactor(d, 0, 0, 55000)).toBeGreaterThan(0.9);
  });

  it("thins with altitude: the same distance is clearer higher up", () => {
    expect(hazeFactor(d, 3000, 0, 20000)).toBeLessThan(hazeFactor(d, 0, 0, 20000) * 0.3);
  });

  it("looking down from altitude sees through the haze layer, not a sea-level path", () => {
    const down = hazeFactor(d, 3000, -3000, 3000);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeLessThan(hazeFactor(d, 0, 0, 3000) * 1.2);
  });
});
