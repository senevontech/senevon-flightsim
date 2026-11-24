/* Mayday scenarios: start in cruise toward an airport; a few seconds later something goes wrong.
   Land safely for a "MAYDAY SURVIVED" result. One scenario is free; the rest are premium items
   (Senevon tokens, see services/entitlements.ts). */
import type { AircraftSim } from "../sim/aircraft";

export type MaydayId = "engine_out" | "rough_engine" | "fuel_leak" | "flap_jam" | "electrical" | "bird_strike" | "storm_approach";

export interface MaydayDef {
  id: MaydayId;
  name: string;
  /** What the player sees in the menu. */
  desc: string;
  /** Short alert shown when it happens. */
  alert: string;
  /** Spoken in the Mayday call. */
  call: string;
  free: boolean;
  /** Price in Senevon tokens (placeholder). */
  price: number;
}

export const MAYDAYS: MaydayDef[] = [
  { id: "engine_out", name: "Engine failure", desc: "The engine quits in cruise. Glide to the runway.", alert: "ENGINE FAILURE", call: "engine failure", free: true, price: 0 },
  { id: "rough_engine", name: "Rough engine", desc: "The engine misfires and surges. Nurse it home on partial power.", alert: "ROUGH RUNNING ENGINE", call: "rough running engine, partial power", free: false, price: 150 },
  { id: "fuel_leak", name: "Fuel leak", desc: "Fuel is pouring out. Land before the tanks run dry.", alert: "FUEL LEAK", call: "fuel leak, low fuel", free: false, price: 150 },
  { id: "flap_jam", name: "Flaps jammed", desc: "The flaps won't extend. Make a fast, flapless landing.", alert: "FLAPS INOPERATIVE", call: "flap failure", free: false, price: 100 },
  { id: "electrical", name: "Electrical failure", desc: "Every instrument goes dark. Fly by looking outside.", alert: "ELECTRICAL FAILURE", call: "total electrical failure", free: false, price: 200 },
  { id: "bird_strike", name: "Bird strike", desc: "A bird cracks the windscreen and damages the engine.", alert: "BIRD STRIKE", call: "bird strike, engine damage", free: false, price: 200 },
  { id: "storm_approach", name: "Storm approach", desc: "Land in a thunderstorm: heavy rain, gusts and crosswind.", alert: "SEVERE WEATHER", call: "severe turbulence in storm, request immediate landing", free: false, price: 250 },
];

export const maydayItemId = (id: MaydayId) => `mayday_${id}`;

export class MaydayDirector {
  active: MaydayDef | null = null;
  triggered = false;
  private triggerAt = 0;
  /** Visual windscreen crack (bird strike). */
  cracked = false;

  start(def: MaydayDef, sim: AircraftSim): void {
    this.active = def;
    this.triggered = false;
    this.cracked = false;
    // the storm is there from the start; everything else happens 6–14 s in
    this.triggerAt = def.id === "storm_approach" ? 0 : sim.time + 6 + Math.random() * 8;
  }

  clear(): void {
    this.active = null;
    this.triggered = false;
    this.cracked = false;
  }

  /** Returns true on the step the failure happens. */
  update(sim: AircraftSim): boolean {
    if (!this.active || this.triggered || sim.time < this.triggerAt) return false;
    this.triggered = true;
    const f = sim.failures;
    switch (this.active.id) {
      case "engine_out": f.engine = "dead"; break;
      case "rough_engine": f.engine = "rough"; break;
      case "fuel_leak":
        sim.fuel = Math.min(sim.fuel, 22);
        f.fuelLeak = 0.12; // ~3 minutes of fuel left
        break;
      case "flap_jam": f.flapsJammed = true; break;
      case "electrical": f.electrical = true; break;
      case "bird_strike":
        f.engine = "rough";
        this.cracked = true;
        break;
      case "storm_approach": break;
    }
    return true;
  }
}
