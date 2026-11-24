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

## 4. Asset register

| File | Source | Licence | Author | Added |
|------|--------|---------|--------|-------|
| — | — | — | — | — |
