/* Which 3D model each aircraft uses. An aircraft with no entry here (or whose file fails to load)
   flies with its coded parametric model (aircraftModel.ts).

   Rules (CLAUDE.md, docs/ASSETS.md): open licences only (CC0 or CC-BY; never NC or GPL), no real
   maker names, logos or liveries, and every model is listed in docs/ASSETS.md and credited in-game. */

export type PartKind = "aileronL" | "aileronR" | "flap" | "elevator" | "rudder" | "prop" | "gear";

/** Ties nodes of the model (matched by name) to a moving part. Hinged parts rotate about `axis`
    in the node's own space, so the node's origin must sit on the hinge line (set in Blender). */
export interface PartBinding {
  kind: PartKind;
  match: RegExp;
  /** Rotation axis in the node's local space (default X for surfaces, Z for propellers). */
  axis?: [number, number, number];
  /** Flip the deflection direction if the model's axis points the other way. */
  sign?: 1 | -1;
}

export interface ModelCredit {
  title: string;
  author: string;
  licence: "CC0-1.0" | "CC-BY-4.0" | "CC-BY-3.0" | "Original";
  source: string;
}

export interface ModelSpec {
  /** File under public/models/: GLB (Meshopt compression supported) or OBJ, with its materials
      in a .mtl of the same name and any textures beside it. OBJ part pivots are set automatically. */
  file: string;
  credit: ModelCredit;
  /** Turn the model about Y so its nose points along −Z (the sim's forward), degrees. */
  yawDeg?: number;
  /** Wingspan to scale to, metres (default: the aircraft design's span). */
  span?: number;
  /** Final nudge after automatic fitting (body frame, metres). */
  offset?: [number, number, number];
  /** Part bindings (default: DEFAULT_PARTS, the names listed in docs/ASSETS.md). */
  parts?: PartBinding[];
  /** Nodes to hide (pilots, display stands, ground shadows baked into the model, logos…). */
  hide?: RegExp;
}

/** Node names from docs/ASSETS.md (aileron_L, aileron_R, elevator, rudder, flap_L/R, gear_*, prop),
    matched loosely so common variants ("Aileron.L", "propeller", "wheel_main") also bind. */
export const DEFAULT_PARTS: PartBinding[] = [
  { kind: "aileronL", match: /aileron[\s._-]*(l|left)\b/i },
  { kind: "aileronR", match: /aileron[\s._-]*(r|right)\b/i },
  { kind: "flap", match: /flap/i },
  { kind: "elevator", match: /elevator/i },
  { kind: "rudder", match: /rudder/i, axis: [0, 1, 0] },
  { kind: "prop", match: /^(prop|propeller)/i, axis: [0, 0, 1] },
  { kind: "gear", match: /^(gear|wheel)/i },
];

/** Aircraft id → model. Filled in as open-licence models are chosen (see docs/ASSETS.md). */
export const MODEL_SPECS: Record<string, ModelSpec> = {};
