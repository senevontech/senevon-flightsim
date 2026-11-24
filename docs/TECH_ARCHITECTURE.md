# Technical Architecture

## 1. Overview

```
Browser (static site on Render)
├── Game runtime (Three.js render loop + 120 Hz flight model)
├── Terrain worker(s)  — chunk heights, normals, biome masks, props placement
├── UI layer (Preact)  — menus, hangar, career map, score screen, settings, HUD overlays
└── Services
    ├── Save (local-first: IndexedDB) ──sync──► Senevon Supabase (when signed in)
    ├── Senevon account (sign-in hand-off, tokens, shop, Plus)
    └── Leaderboards / daily challenge / ghosts (Supabase RPCs + table)
```

There is no game server. Everything authoritative (money, tokens, unlocks bought with tokens)
stays in Senevon's Supabase functions, which already exist or are drafted in `integration/`.

## 2. Planned folder structure

```
flight_sim/
├── index.html
├── public/                 # static assets served as-is (audio, textures, models, icons)
├── src/
│   ├── main.ts             # boot: detect quality, load core assets, start the app
│   ├── app/                # app state machine: boot → menu → briefing → flight → results
│   ├── engine/             # renderer, camera rigs, floating origin, render-loop & fixed step
│   ├── sim/                # flight model: atmosphere, aero surfaces, engines, gear, assists
│   │   └── __tests__/      # Vitest: flight test checklist, landing score
│   ├── aircraft/           # aircraft JSON configs + model/livery loaders + cockpit instruments
│   ├── world/
│   │   ├── WorldProvider.ts       # interface: heightAt(), surfaceAt(), streamChunks(), airports()
│   │   ├── procedural/            # Phase 1 provider: noise, biomes, chunk LOD, airports, props
│   │   └── realworld/             # Phase 2 provider: 3D Tiles (stub until Phase 8)
│   ├── env/                # sky, sun/time of day, clouds, fog, ocean, weather presets
│   ├── input/              # keyboard, mouse yoke, gamepad/joystick, tilt, touch; mapping
│   ├── gameplay/           # missions, objectives, scoring, career, daily, ghosts, achievements
│   ├── audio/              # WebAudio engine sound, wind, callouts, UI sounds
│   ├── ui/                 # Preact components: menus, HUD, score screen, hangar, settings
│   ├── services/
│   │   ├── senevon.ts      # sign-in hand-off, state, buy() — port of senevon-account.js
│   │   ├── supabase.ts     # client (public URL + anon key from env)
│   │   ├── save.ts         # IndexedDB local save + cloud sync
│   │   └── leaderboard.ts  # submit + read boards, daily challenge, ghost upload/download
│   └── workers/            # terrain.worker.ts
├── integration/            # SQL + notes for the Senevon repo (applied by the owner, not by us)
├── docs/
├── render.yaml
└── vite.config.ts
```

## 3. Key systems

### 3.1 Render loop and timestep
- `requestAnimationFrame` → accumulate real time → run `sim.step(1/120)` N times (max 8 per frame
  so a slow frame can't snowball) → interpolate render transforms → render.
- The simulation runs on the main thread (cheap). Terrain generation runs in workers.

### 3.2 Precision (floating origin deferred)
- World positions are kept in double precision (JS numbers) in the sim.
- three.js multiplies model and view matrices in float64 on the CPU, and terrain chunks store
  their vertices relative to the chunk centre, so a 65 km region renders without jitter.
- A true floating origin (re-centring the scene) is still needed for the real-world phase
  (Earth-centred coordinates); add it with the `realworld` provider.

### 3.3 Procedural terrain (Phase 1, built)
Code: `src/world/procedural/coralCoast.ts` (pure height, biome and mask functions, also used in
the workers), `src/workers/terrain.worker.ts`, `src/engine/terrain.ts`.
- Quadtree from 64 km down to 256 m chunks (33×33 vertices + skirts). Split when the camera is
  within 1.7× a node's size. Old chunks stay until all their replacements are ready.
- Heights: islands from warped distance fields + fBm coast noise; reef shelf; hills; ridged
  mountains; a volcano cone with a crater. Airports are flattened pads with a 450 m blend.
- Physics uses `ProceduralWorld.heightAt` = max(terrain, sea level), the same function as the mesh.

Original plan notes:
- Quadtree LOD (CDLOD-style). Each chunk is a 33×33 or 65×65 grid with skirts to hide seams.
- Height = seeded fBm + ridged noise + domain warp, shaped by a region "macro map" (coastline
  mask, mountain mask). Airports carve flat pads through a blend mask.
- A terrain shader does slope/height/biome blending with triplanar detail textures, plus
  distance fog matched to the sky.
- Collision queries (`heightAt(x, z)`) use the same function as the mesh, so physics and
  visuals agree. The function runs on the main thread for the aircraft's few query points.
- Props: instanced trees (impostors at distance), instanced buildings for towns and cities,
  placed deterministically from the seed per chunk.

### 3.4 Environment
- Sky: analytic atmospheric scattering (Three.js `Sky` or a Hosek-Wilkie style), sun position
  from the time of day.
- Clouds: layered billboard and impostor cloud puffs with soft particles (cheap and good-looking);
  a ray-marched layer only on Ultra.
- Ocean: a Gerstner-wave vertex shader near the camera, a flat normal-mapped plane far away,
  with fresnel and sun glint.
- Weather presets: Clear, Hazy, Scattered, Overcast, Rain, Storm, Fog. Each sets wind,
  turbulence, cloud cover, visibility and light.

### 3.5 Input
- All devices write into one `ControlInputs` object (pitch, roll, yaw, throttle, flaps, gear,
  brakes, …) with per-axis curves and dead-zones.
- Tilt: `DeviceOrientationEvent` with a permission request on iOS, calibrated to a neutral
  angle, low-pass filtered.
- The remapping UI is stored in the save.

### 3.6 Save and sync
- Local-first in IndexedDB: career, credits, logbook, settings, achievements.
- When signed in: sync to Supabase (`skyward_state` jsonb per user, last-write-wins with a
  `rev` counter; a server RPC merges counters such as credits safely). See
  SENEVON_INTEGRATION.md.
- Token-bought unlocks are **never** saved locally as truth. They are asked from Senevon each
  session (the DroidDoom rule).

### 3.7 Ghosts and replays
- Recorded at 10 Hz: position (quantized), orientation (compressed quaternion), gear/flaps and
  throttle. Delta-encoded, then gzip-compressed through `CompressionStream`. About 10–20 KB for a
  5-minute flight.
- Played back with interpolation. Ghosts are not physically simulated.
- Uploaded with leaderboard entries for the top N, so they can be raced and checked later.

### 3.8 Audio
- WebAudio graph: engine (2–4 looped samples crossfaded by RPM, pitch-shifted), propeller/jet
  layer, wind (filtered noise by airspeed), rolling and tyre sounds, stall horn, gear motor,
  callouts, and a UI bus. The listener follows the camera; cockpit view gets a low-pass "inside"
  filter.

## 4. Quality presets

| Setting | Low | Medium | High | Ultra |
|---------|-----|--------|------|-------|
| Render scale | 0.7 | 0.85 | 1.0 | 1.0 (DPR ≤ 2) |
| Terrain LOD distance | 15 km | 30 km | 60 km | 100 km |
| Shadows | off | aircraft only | cascaded 2 | cascaded 3 |
| Clouds | 2D layer | impostors | impostors+ | ray-marched |
| Trees / buildings | sparse | normal | dense | dense |
| Water | flat + normals | Gerstner near | Gerstner | + reflections |

A quick benchmark on the first run picks the preset, which can be changed in Settings. A dynamic
resolution fallback keeps the frame rate above target.

## 5. Build and deploy

- `npm run build` → `dist/` (static). Assets are fingerprinted and immutably cached (same header
  rule as Senevon's `render.yaml`).
- `render.yaml`: a static site with an SPA rewrite and env vars
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the **public** Senevon values) and
  `VITE_SENEVON_URL`.
- Large assets (aircraft models, textures, audio) are lazy-loaded per aircraft and region, so the
  first flight needs only the Sparrow and the Coral Coast.
- Models: glTF/GLB with Draco or Meshopt compression; textures as KTX2 (Basis) where supported.

## 6. Testing

- **Vitest:** flight test checklist per aircraft, landing-score maths, economy formulas, ghost
  encode/decode round-trip.
- **Manual playtest checklist** each milestone (PROGRESS.md).
- **Device matrix:** one low-end Android (Chrome), one iPhone (Safari), one desktop with Chrome,
  Firefox and Edge, one gamepad.

## 7. Dependencies (pin exact versions at scaffold time)

`three`, `@types/three`, `preact`, `@preact/signals`, `@supabase/supabase-js`, `simplex-noise`
(or our own), `vite`, `typescript`, `vitest`. Later: `3d-tiles-renderer` (Phase 8),
`meshoptimizer` decoder.
