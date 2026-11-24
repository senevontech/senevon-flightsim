import type { AircraftConfig } from "../sim/types";
import sparrow from "./sparrow-s1.json";
import kestrel from "./kestrel-k2.json";
import otter from "./otter-b4.json";
import heron from "./heron-t2.json";
import falcon from "./falcon-j5.json";

/** The fleet, in hangar order (trainer → aerobatic → bush → twin → jet). */
export const AIRCRAFT: Record<string, AircraftConfig> = {
  "sparrow-s1": { description: "High-wing trainer. Stable, forgiving and slow: the perfect first plane.", ...(sparrow as AircraftConfig) },
  "kestrel-k2": kestrel as AircraftConfig,
  "otter-b4": otter as AircraftConfig,
  "heron-t2": heron as AircraftConfig,
  "falcon-j5": falcon as AircraftConfig,
};

export const AIRCRAFT_ORDER = Object.keys(AIRCRAFT);
