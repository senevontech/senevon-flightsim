/* Visual designs for the fleet: the parametric model builder (aircraftModel.ts) turns these into
   meshes. Body frame: +X right, +Y up, −Z forward; origin = CG (matches the flight model).
   All designs are original (no real manufacturer shapes or liveries). */

export interface LiftingSurfaceDesign {
  /** Full span (m). */
  span: number;
  rootChord: number;
  tipChord: number;
  /** How far back the tip's leading edge sits relative to the root's (m). */
  sweep: number;
  /** Root leading edge position (body). For a fin, `y` is the base. */
  y: number;
  z: number;
  dihedral?: number; // degrees
  thickness?: number;
}

export interface Livery {
  base: string;
  belly: string;
  stripe: string;
  accent: string;
  reg: string;
  /** Cabin windows: number per side, from / to (fraction along the fuselage), size (fraction). */
  windows: { count: number; v0: number; v1: number; tall: number };
}

export interface Design {
  /** Fuselage radius profile along z: [radius, z] from nose to tail. */
  profile: [number, number][];
  /** Fuselage cross-section squash: [width, height] multipliers. */
  section: [number, number];
  fuselageY: number;
  canopy: { type: "dome" | "bubble" | "airliner"; y: number; z: number; size: [number, number, number] };
  wing: LiftingSurfaceDesign;
  hstab: LiftingSurfaceDesign;
  fin: Omit<LiftingSurfaceDesign, "span" | "dihedral"> & { height: number };
  struts?: boolean;
  engines: { kind: "noseProp" | "wingProp" | "rearJet"; pos: [number, number, number]; propDia: number; blades: number; nacelle?: [number, number] }[];
  floats?: { x: number; y: number; z0: number; z1: number; width: number; height: number };
  livery: Livery;
}

export const DESIGNS: Record<string, Design> = {
  "sparrow-s1": {
    profile: [[0, -2.62], [0.3, -2.55], [0.48, -2.3], [0.57, -1.9], [0.62, -1.0], [0.63, 0], [0.56, 1.0], [0.4, 2.4], [0.26, 3.8], [0.16, 5.0], [0, 5.25]],
    section: [0.92, 1.08],
    fuselageY: 0.05,
    canopy: { type: "dome", y: 0.42, z: -0.75, size: [0.82, 0.55, 1.15] },
    wing: { span: 11, rootChord: 1.15, tipChord: 1.15, sweep: 0, y: 1.02, z: -0.6, dihedral: 1.7, thickness: 0.13 },
    hstab: { span: 3.4, rootChord: 1.0, tipChord: 0.75, sweep: 0.15, y: 0.2, z: 4.1 },
    fin: { height: 1.3, rootChord: 1.15, tipChord: 0.6, sweep: 0.55, y: 0.25, z: 4.15 },
    struts: true,
    engines: [{ kind: "noseProp", pos: [0, 0.1, -2.62], propDia: 1.9, blades: 2 }],
    livery: { base: "#f4f2ed", belly: "#c9ccd1", stripe: "#ff6a00", accent: "#ff6a00", reg: "SW-01K", windows: { count: 2, v0: 0.2, v1: 0.42, tall: 0.08 } },
  },
  "kestrel-k2": {
    profile: [[0, -2.25], [0.22, -2.18], [0.42, -1.9], [0.5, -1.2], [0.5, 0], [0.4, 1.2], [0.26, 2.6], [0.14, 3.9], [0, 4.4]],
    section: [0.9, 1.0],
    fuselageY: 0,
    canopy: { type: "bubble", y: 0.42, z: 0.15, size: [0.42, 0.36, 1.25] },
    wing: { span: 7.5, rootChord: 1.65, tipChord: 0.95, sweep: 0.35, y: -0.35, z: -0.6, dihedral: 3.5, thickness: 0.16 },
    hstab: { span: 2.9, rootChord: 0.85, tipChord: 0.5, sweep: 0.25, y: 0.1, z: 3.55 },
    fin: { height: 1.05, rootChord: 1.0, tipChord: 0.55, sweep: 0.5, y: 0.3, z: 3.55 },
    engines: [{ kind: "noseProp", pos: [0, 0, -2.25], propDia: 1.6, blades: 3 }],
    livery: { base: "#f5f5f3", belly: "#d62f2f", stripe: "#d62f2f", accent: "#1d2a3a", reg: "SW-K2X", windows: { count: 0, v0: 0, v1: 0, tall: 0 } },
  },
  "otter-b4": {
    profile: [[0, -3.0], [0.5, -2.95], [0.72, -2.6], [0.78, -1.6], [0.82, 0], [0.74, 1.6], [0.5, 3.6], [0.3, 5.6], [0.18, 6.8], [0, 7.1]],
    section: [0.85, 1.12],
    fuselageY: 0.15,
    canopy: { type: "dome", y: 0.68, z: -1.2, size: [1.0, 0.55, 1.2] },
    wing: { span: 14.6, rootChord: 1.65, tipChord: 1.5, sweep: 0.05, y: 1.35, z: -0.6, dihedral: 2, thickness: 0.18 },
    hstab: { span: 5.0, rootChord: 1.3, tipChord: 0.9, sweep: 0.2, y: 0.45, z: 5.85 },
    fin: { height: 2.0, rootChord: 1.6, tipChord: 0.8, sweep: 0.7, y: 0.55, z: 5.85 },
    struts: true,
    engines: [{ kind: "noseProp", pos: [0, 0.3, -3.0], propDia: 2.6, blades: 3 }],
    floats: { x: 1.4, y: -1.55, z0: -3.4, z1: 4.0, width: 0.55, height: 0.55 },
    livery: { base: "#f2b705", belly: "#1d3a5f", stripe: "#1d3a5f", accent: "#ffffff", reg: "SW-OTR", windows: { count: 3, v0: 0.18, v1: 0.42, tall: 0.07 } },
  },
  "heron-t2": {
    profile: [[0, -4.7], [0.45, -4.5], [0.8, -3.9], [0.98, -2.8], [1.02, 0], [1.0, 3.0], [0.75, 5.6], [0.45, 7.6], [0.2, 8.5], [0, 8.7]],
    section: [0.92, 1.0],
    fuselageY: 0,
    canopy: { type: "airliner", y: 0.42, z: -3.7, size: [1.5, 0.35, 0.9] },
    wing: { span: 16.6, rootChord: 2.3, tipChord: 1.2, sweep: 0.35, y: -0.65, z: -0.8, dihedral: 5, thickness: 0.24 },
    hstab: { span: 6.2, rootChord: 1.6, tipChord: 0.9, sweep: 0.5, y: 0.5, z: 7.0 },
    fin: { height: 2.4, rootChord: 2.2, tipChord: 1.0, sweep: 1.3, y: 0.75, z: 6.5 },
    engines: [
      { kind: "wingProp", pos: [-3.0, -0.2, -1.5], propDia: 2.4, blades: 4, nacelle: [3.6, 0.48] },
      { kind: "wingProp", pos: [3.0, -0.2, -1.5], propDia: 2.4, blades: 4, nacelle: [3.6, 0.48] },
    ],
    livery: { base: "#f6f6f4", belly: "#9aa4b0", stripe: "#1b4f9c", accent: "#ff7a1a", reg: "SW-HRN", windows: { count: 6, v0: 0.3, v1: 0.62, tall: 0.05 } },
  },
  "falcon-j5": {
    profile: [[0, -5.9], [0.3, -5.6], [0.62, -4.9], [0.86, -3.8], [0.96, -2.0], [0.97, 1.5], [0.85, 4.0], [0.55, 6.2], [0.25, 7.4], [0, 7.7]],
    section: [0.95, 1.0],
    fuselageY: 0,
    canopy: { type: "airliner", y: 0.38, z: -4.6, size: [1.35, 0.3, 0.9] },
    wing: { span: 15.8, rootChord: 2.8, tipChord: 1.0, sweep: 1.9, y: -0.75, z: -0.8, dihedral: 3, thickness: 0.22 },
    hstab: { span: 5.8, rootChord: 1.5, tipChord: 0.8, sweep: 1.0, y: 2.35, z: 6.45 },
    fin: { height: 2.3, rootChord: 2.5, tipChord: 1.4, sweep: 1.9, y: 0.55, z: 5.4 },
    engines: [
      { kind: "rearJet", pos: [-1.35, 0.6, 4.5], propDia: 0, blades: 0, nacelle: [2.7, 0.42] },
      { kind: "rearJet", pos: [1.35, 0.6, 4.5], propDia: 0, blades: 0, nacelle: [2.7, 0.42] },
    ],
    livery: { base: "#f7f7f7", belly: "#b8bec6", stripe: "#2b2f36", accent: "#c9a227", reg: "SW-JET", windows: { count: 5, v0: 0.3, v1: 0.52, tall: 0.06 } },
  },
};
