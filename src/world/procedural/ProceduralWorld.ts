/* WorldProvider backed by the procedural Coral Coast region. */
import { CoralCoast } from "./coralCoast";
import { onRunway, type Airport, type SurfaceType, type WorldProvider } from "../WorldProvider";

export class ProceduralWorld implements WorldProvider {
  readonly region = new CoralCoast();

  /** Ground or water surface height (the sea surface is at 0). */
  heightAt(x: number, z: number): number {
    return Math.max(0, this.region.height(x, z));
  }

  surfaceAt(x: number, z: number): SurfaceType {
    for (const a of this.region.airports) {
      for (const r of a.runways) if (onRunway(r, x, z)) return r.surface ?? "asphalt";
    }
    return this.region.surfaceAt(x, z);
  }

  airports(): Airport[] {
    return this.region.airports;
  }
}
