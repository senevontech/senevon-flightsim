import type { AircraftConfig } from "../sim/types";
import sparrow from "./sparrow-s1.json";

export const AIRCRAFT: Record<string, AircraftConfig> = {
  "sparrow-s1": sparrow as AircraftConfig,
};
