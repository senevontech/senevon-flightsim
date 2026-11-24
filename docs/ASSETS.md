# Assets Plan (art & audio)

## 1. Rules

- **Original designs only.** No real manufacturer names, logos or recognisable trade-dress
  liveries, and no assets ripped from other games.
- Licences must allow commercial use: CC0 preferred, CC-BY with credit allowed (credits go in
  `public/CREDITS.txt` and the in-game About screen).
- Every asset added gets a line in the asset register below: file, source, licence, author.

## 2. Formats & budgets

| Asset | Format | Budget |
|-------|--------|--------|
| Aircraft exterior | GLB (Meshopt/Draco) | LOD0 ≤ 25 k tris, LOD1 ≤ 8 k, LOD2 ≤ 1.5 k; ≤ 1.5 MB per aircraft |
| Aircraft cockpit | GLB | ≤ 30 k tris; gauges drawn on canvas textures |
| Liveries | KTX2 (fallback WebP) | 2048² (High), 1024² (Low) |
| Terrain detail textures | KTX2 array | 6–8 layers × 512² |
| Props (buildings, hangars, towers, trees) | GLB, instanced | ≤ 2 k tris each; tree impostor atlas |
| Audio loops | OGG + AAC fallback | ≤ 150 KB per loop; total first-flight audio ≤ 1 MB |
| UI icons | SVG (lucide-style, matching Senevon) | — |

## 3. Sources (to confirm with the owner)

| Need | Options |
|------|---------|
| Aircraft models | (a) built in Blender to our spec, best fit for the flight model's control surfaces; (b) commissioned low-poly artist; (c) CC0 bases (e.g. Quaternius, Kenney, Poly Pizza CC0) modified heavily |
| Airport props, buildings, trees | Kenney / Quaternius CC0 packs, our own procedural buildings |
| Terrain textures | ambientCG and Poly Haven (CC0) |
| Sky / HDRI | Poly Haven (CC0) for menus; the in-flight sky is procedural |
| Engine and wind sounds | Freesound (CC0 filter) + synthesis in WebAudio |
| Callouts ("fifty, thirty, ten") | Recorded by us, or a TTS voice with a commercial licence |
| Music (menus) | CC0 / royalty-free ambient, or commissioned |

Each aircraft model needs **separate named nodes** for animated parts: `aileron_L`, `aileron_R`,
`elevator`, `rudder`, `flap_L`, `flap_R`, `gear_*`, `prop`, `door_*`, plus empties for the camera
points and wheel contact points.

## 3b. Using open-licence aircraft models (GLB)

Pipeline (built 2026-11-24): `src/engine/modelSpecs.ts` maps an aircraft id to a GLB in
`public/models/`; `src/engine/glbModel.ts` loads it (Meshopt supported), fits it to the flight model
(nose to −Z via `yawDeg`, scaled to the design wingspan, centred on the fuselage, wheels on the sim's
gear contact line, optional `offset`) and drives its parts. Until the file loads, or if it fails,
the coded model is shown. Dev URL options: `?glb=<file>` tries a file on the current aircraft,
`?model=coded` forces the coded model; `window.__skyward.model.parts` lists what was bound.

Preparing a model (Blender):
1. Licence is CC0 or CC-BY (never NC, never GPL, never "editorial"); record it below.
2. Remove maker names, logos, real registrations and recognisable real liveries; paint ours.
3. Split moving parts into separate objects and set each origin on its hinge line:
   `aileron_L`, `aileron_R`, `flap_L`, `flap_R`, `elevator` (or `elevator_L/R`), `rudder`, `prop`
   (origin at the hub, spinning about local Z), `gear_*` (folds away with the gear lever).
   Hinged surfaces rotate about local X (rudder: local Y); set `parts` in the spec to override.
4. Decimate to ≤ 25 k triangles and export GLB with Meshopt compression (≤ 1.5 MB).

## 4. Asset register

| File | Source | Licence | Author | Added |
|------|--------|---------|--------|-------|
| Aircraft models (all 5) | Procedural, built in code from `src/engine/designs.ts` | Original (Skyward) | Skyward team | 2026-11-24 |
| Liveries (all 5) | Canvas-painted in `src/engine/aircraftModel.ts` | Original (Skyward) | Skyward team | 2026-11-24 |
| `public/icon/snv-air-icon*.png` (favicon 32/512, touch icon 180; cropped square from the owner's original) | Supplied by owner | Owner-provided | Senevon | 2026-11-24 |
