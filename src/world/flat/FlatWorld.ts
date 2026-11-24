/* P0 test world: flat ground at sea level with one paved runway (36/18) and a grass field.
   Replaced by the procedural provider in Phase 1. */
import { onRunway, type Airport, type SurfaceType, type WorldProvider } from "../WorldProvider";

export const HOME: Airport = {
  id: "SKY1",
  name: "Skyward Field",
  elevation: 0,
  runways: [
    {
      id: "36",
      name: "36",
      // runway runs from z = +600 (south threshold) to z = −600, landing north
      threshold: { x: 0, y: 0, z: 600 },
      headingDeg: 0,
      length: 1200,
      width: 30,
      aimPoint: 300,
    },
  ],
};

export class FlatWorld implements WorldProvider {
  heightAt(_x: number, _z: number): number {
    return 0;
  }
  surfaceAt(x: number, z: number): SurfaceType {
    return onRunway(HOME.runways[0], x, z) ? "asphalt" : "grass";
  }
  airports(): Airport[] {
    return [HOME];
  }
}
