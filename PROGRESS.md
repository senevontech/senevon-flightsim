# Skyward — Progress Sheet

**Legend:** ⬜ Not started · 🟨 In progress · ✅ Done · ⛔ Blocked · ⏸ Deferred
**Last updated:** 2026-11-23 · **Current phase:** P1 — Coral Coast world built; waiting on the owner's visual check

## Milestone overview

| Phase | Name | Goal (exit criteria) | Status |
|-------|------|----------------------|--------|
| P-1 | Pre-production | Docs agreed by the owner | ✅ |
| P0 | Flight prototype | One plane, flat world + runway; takeoff, fly and land feel good on keyboard | ✅ |
| P1 | World | Procedural Coral Coast streams smoothly with sky, ocean, clouds and airports | 🟨 |
| P2 | Aircraft & feel | 4 aircraft, cockpit view, instruments, sound, crashes, Free Flight | ⬜ |
| P3 | Gameplay | Flight School, Career with 6 mission types, landing score, credits/XP/ranks | ⬜ |
| P4 | Mobile | Tilt and touch controls, quality presets, 30 fps on a low-end Android | ⬜ |
| P5 | Senevon | Sign-in hand-off, cloud save, token shop, Plus access, main leaderboard | ⬜ |
| P6 | Retention | Daily Challenge, streaks, challenges, ghost races, weekly league, achievements | ⬜ |
| P7 | Polish & launch | Weather, time of day, replays, onboarding, analytics, Render deploy, listed on Senevon | ⬜ |
| P8 | Later | Real-world 3D Tiles mode, live multiplayer, helicopter, Android app | ⏸ |

---

## Task sheet

| ID | Phase | Task | Status | Notes |
|----|-------|------|--------|-------|
| D-01 | P-1 | Brainstorm + design pillars | ✅ | details.md |
| D-02 | P-1 | GDD (details.md) | ✅ | |
| D-03 | P-1 | Flight model spec | ✅ | docs/FLIGHT_MODEL.md |
| D-04 | P-1 | Technical architecture | ✅ | docs/TECH_ARCHITECTURE.md |
| D-05 | P-1 | Economy & progression | ✅ | docs/GAMEPLAY_AND_ECONOMY.md |
| D-06 | P-1 | Senevon integration plan | ✅ | docs/SENEVON_INTEGRATION.md |
| D-07 | P-1 | Assets plan | ✅ | docs/ASSETS.md |
| D-08 | P-1 | Owner answers open questions (details.md §20) | ⏸ | Building with defaults: Skyward, UTC, code-built models, guests allowed |
| P0-01 | P0 | Scaffold Vite + TS + Three.js + Preact + Vitest; git init | ✅ | three 0.186.1, vite 7.3.6, ts 5.9.3, vitest 4.1.12; no Preact yet (P3) |
| P0-02 | P0 | Render loop, fixed 120 Hz step, interpolation | ✅ | src/main.ts; max 8 steps/frame |
| P0-03 | P0 | Atmosphere (ISA) + wind basics | ✅ | src/sim/atmosphere.ts; wind + gusts + turbulence, deterministic |
| P0-04 | P0 | Aero surfaces, lift/drag curves, stall | ✅ | src/sim/aero.ts + aircraft.ts; per-surface, dihedral, downwash, ground effect |
| P0-05 | P0 | Piston engine + propeller effects | ✅ | torque roll + P-factor yaw, fuel burn |
| P0-06 | P0 | Landing gear spring-damper, brakes, steering | ✅ | per-surface friction, nose-wheel steering, crash on bottoming |
| P0-07 | P0 | Sparrow S1 config + placeholder model | ✅ | src/aircraft/sparrow-s1.json; model in src/engine/aircraftModel.ts |
| P0-08 | P0 | Keyboard + gamepad input, assists (coordination, auto-trim, stall protection) | ✅ | src/input/controls.ts, src/sim/assists.ts; Easy/Normal/Real (M) |
| P0-09 | P0 | Chase + cockpit camera | ✅ | src/engine/cameras.ts; drag to orbit/look, wheel zoom |
| P0-10 | P0 | Minimal HUD (IAS, ALT, VS, HDG, throttle, flaps, gear) | ✅ | src/ui/hud.ts; plus stick indicator, stall warning, RA callouts |
| P0-11 | P0 | Landing detection + landing score v1 + unit tests | ✅ | src/gameplay/landing.ts; landing card, best score saved locally |
| P0-12 | P0 | Flight-test checklist tests (Sparrow targets ±10%) | ✅ | 7 flight tests + 6 landing tests passing |
| P0-13 | P0 | **Playtest gate:** "is flying fun?" | ✅ | Controls reworked (P0-15); owner said "next" |
| P0-15 | P0 | Controls rework after the first playtest: fly-by-wire assists (rate/attitude command), mouse flying (Y), invert pitch (I), no Ctrl bindings, handling tests | ✅ | 8 handling tests; 21 tests total |
| P0-14 | P0 | Extras: PAPI lights, approach gates, windsock, synth engine/wind/stall-horn audio, trees + villages, approach start (L) | ✅ | Pulled forward to make landing practice fun |
| P1-01 | P1 | WorldProvider interface + floating origin | ✅ | WorldProvider + runwayPair(); floating origin not needed at this scale (see Decisions) |
| P1-02 | P1 | Noise terrain + quadtree LOD chunks in a worker | ✅ | src/engine/terrain.ts + src/workers/terrain.worker.ts; 256 m–64 km chunks, skirts, 1–3 workers, ~4 ms/chunk |
| P1-03 | P1 | Terrain shader (biomes, triplanar, fog) | ✅ | vertex-colour biomes (reef → sand → grass → forest → rock → lava) + 2-scale detail texture |
| P1-04 | P1 | Ocean shader | ✅ | src/engine/ocean.ts; see-through shallows, wave normals, fresnel, sun glitter |
| P1-05 | P1 | Sky + sun + time of day | ✅ | T cycles 5 times of day; sky, sun, fog, IBL, ocean and clouds follow |
| P1-06 | P1 | Clouds (impostors) | ✅ | src/engine/clouds.ts; ~2000 instanced puffs in 170 cumulus clusters, depth-sorted |
| P1-07 | P1 | Airport generator + terrain flattening + runway markings and lights | ✅ | src/engine/airports.ts; markings, grass strips, hangars/tower/terminal by size, PAPI both ends, windsocks |
| P1-08 | P1 | Instanced trees and towns | ✅ | src/engine/scatter.ts; trees, palms, houses in 1 km tiles, 3 draw calls total |
| P1-09 | P1 | Coral Coast region macro map + 6–8 airports | ✅ | src/world/procedural/coralCoast.ts; 7 islands incl. volcano, 7 airports (sites searched for flatness + clear approaches) |
| P1-10 | P1 | Nearest-airport pointer, N (next airport), L (approach into wind at nearest airport), ditching in the sea, loading screen | ✅ | |
| P1-11 | P1 | Region tests: determinism, flat runways, 14 approaches clear of terrain, takeoff in-world, chunk speed | ✅ | 26 tests total |
| P1-12 | P1 | **Owner visual check** of the Coral Coast (look, frame rate, pop-in) | 🟨 | Claude couldn't view it (browser extension not connected) |
| R1-01 | P1+ | Graphics: exponential haze, smooth tileable detail + fake relief on terrain, painted livery (cheat line, windows, registration SW-01K), windscreen dome, town-centre blocks | ✅ | Owner request "more realistic" |
| R1-02 | P1+ | HUD redesign: canvas airspeed / attitude / altimeter / VSI, heading tape with track marker, engine & config strip, status tags | ✅ | Minimal, original design |
| R1-03 | P1+ | Moving map (worker-rendered island map, airports, runway lines; Tab / tap to enlarge) | ✅ | |
| R1-04 | P1+ | Menu panel (Fly / Assists / Controls / Graphics / Keys), tappable; replaces the pause screen | ✅ | |
| R1-05 | P1+ | Mobile: floating stick, tilt steering + calibration, throttle slider, buttons, touch layout, safe areas, rotate hint | ✅ | Needs a real-phone test (tilt axes) |
| R1-06 | P1+ | Features: autopilot (J), rewind 10 s (Backspace; Easy ∞ / Normal 3 / Real 0), wing / tower / fly-by cameras, tower radio messages | ✅ | Rewind determinism test added (28 tests) |
| R1-07 | P1+ | Owner check of R1 on desktop + phone | 🟨 | |
| R2-01 | P1+ | Frosted-glass HUD: 3 % panels, 18 px backdrop blur, hairline borders, 2 px corners; text shadows; gauge label overlaps fixed | ✅ | Owner request |
| R2-02 | P1+ | Taxi fix: bank input (A/D, arrows, phone stick, tilt) steers the nose wheel in every mode; 5 taxi tests | ✅ | Before: only Q/E steered |
| R2-03 | P1+ | Mobile refinement: bigger square glass stick with finer centre response, throttle with IDLE/FULL snap + haptics, held-brake feedback, sensitivity Low/Medium/High | ✅ | Needs a real-phone test |
| R2-04 | P1+ | Weather: 7 presets + custom (wind, gusts, turbulence, cumulus, overcast deck, visibility, rain, lightning); rain streaks + sound, thunder, storm light | ✅ | Menu → Weather |
| R2-05 | P1+ | Graphics: new cumulus (flat bases, towers, brighter), clumped trees, window facades, farmland patchwork | ✅ | |
| R2-06 | P1+ | Mayday: 7 scenarios (engine out free; 6 premium), failures in the sim, Mayday radio exchange, alert banner, dead instruments, cracked windscreen, "MAYDAY SURVIVED" | ✅ | 47 tests |
| R2-08 | P1+ | HUD backgrounds removed: transparent top bar, strip and toasts; round gauges on a 2 % circular frosted disc; no backdrop saturation (it tinted panels blue) | ✅ | Owner feedback on R2-01 |
| R2-09 | P1+ | Adaptive HUD contrast: frame brightness sampled behind each element 4×/s; dark marks over bright sky/runway, light over dark ground/sea, with hysteresis | ✅ | Owner: numbers unreadable on bright backgrounds |
| R3-01 | P1+ | "Plane goes left" fixed: rigging (fin + wing incidence) for straight trimmed cruise; takeoff heading hold (Easy/Normal) | ✅ | Takeoff: 4.3° / 8 m → 0.0° / 0.2 m; Real cruise: 28° → < 10° bank in 60 s |
| R3-02 | P1+ | Real-aircraft feel: propwash over the tail, control linkage rate, camber-raised stall limit, tail-strike protection, predictive stall guard, camera shake, model shows real surface positions | ✅ | |
| R3-03 | P1+ | Autopilot rebuilt: HDG, ALT+VS, SPD autothrottle, NAV → APR (centreline + 3° glide path to minimums), panel with hold-repeat buttons, disconnect chime | ✅ | 6 autopilot tests |
| R3-04 | P1+ | Time acceleration 1× / 2× / 4× / 6× (X or chip), above 500 ft only; auto back to 1× below | ✅ | Same physics steps, just more per frame |
| R4-01 | P2 | Fleet: Kestrel K2 (aerobatic), Otter B4 (amphibian), Heron T2 (twin turboprop), Falcon J5 (twin jet), all tested in the sim against real-class numbers | ✅ | 104 tests |
| R4-02 | P2 | Multi-engine (asymmetric thrust), turboprop + jet spool models, retractable gear (G, lights, horn, belly landing), floats + water ops + water start, per-type engine sound, overspeed warning | ✅ | |
| R4-03 | P2 | Parametric aircraft models (swept/tapered wings, T-tail, nacelles, rear jets, floats, struts, liveries, hinged surfaces, retracting gear) + geometry tests | ✅ | Needs a visual check |
| R4-04 | P2 | Hangar tab: switch aircraft live (remembered) | ✅ | Credits/token unlocks come with the economy (P3/P5) |
| R5-01 | P1 | Graphics step 1: height haze with sun glow (aerial perspective), sky blended into the haze at the horizon, high cirrus layer tied to the weather | ✅ | `src/engine/haze.ts`, 3 tests |
| R5-02 | P1 | Glare (bloom from the sun disc and glints only), HDR + 4× MSAA buffer, light lens curve; High quality only | ✅ | `src/engine/post.ts` |
| R5-03 | P1 | Shadows: 250 m box around the aircraft growing with height, snapped to texels; trees/buildings cast on High; ambient light rebalanced (sun-less ambient map) so shade is visible | ✅ | Fixed a latent bug: shadow projection was never updated |
| R5-04 | P1 | Ocean: sea-depth grid from a worker → clearer shallows, surf on beaches and reef edges, wind whitecaps, noise-broken swell (no glitter stripes) | ✅ | |
| R5-05 | P1 | Ground: cliffs with strata, grass patches, beach ripples; tree colour fix (was ~3× too bright); beach band limited to the real shoreline; muted greens; brighter HDR cumulus | ✅ | |
| R5-06 | P1 | Visual check harness: headless Chrome screenshots + console errors; `?quality=`, `?spawn=approach`, `?time=` URL options | ✅ | Visual checks no longer depend on the browser extension |
| R6-01 | P1 | Phones showed a blank screen: the touch panel's class `touch` also matched `<body class="touch">`, so `.touch { display: none }` hid the whole page. Panel renamed `touch-ui` | ✅ | Found with phone emulation (`MOBILE=1 node tools/shot.mjs`) |
| R6-02 | P1 | Responsive touch layout: landscape = one instrument strip on top (gauges, tape, map) with a clear centre; portrait = map row + gauge row; compact thumb buttons + throttle; round stick that springs back; GEAR only on retractable aircraft; wider camera view on tall screens; no more rotate overlay; menu uses dvh | ✅ | Checked at 844×390 and 390×844 |
| R7-01 | P2 | GLB aircraft pipeline: per-aircraft spec (file, credit, licence), auto-fit to the flight model, moving parts by node name, prop blur, gear fold, coded model as instant fallback; coded parts now carry the standard node names | ✅ | Verified end to end with an exported test GLB (14 parts bound); 4 tests |
| R7-02 | P2 | Pick open-licence (CC-BY) models for the five aircraft; owner downloads from Sketchfab (login needed) | 🟡 | Shortlist given 2026-11-24 |
| R7-03 | P2 | Prepare each model in Blender (scripted): strip branding, split/rename parts, hinge origins, ≤ 25 k tris, Meshopt GLB; credit in docs/ASSETS.md + in-game | ⬜ | Blender 5.0 available locally |
| R5-07 | P1 | Graphics step 1b: photo-based CC0 ground textures (needs the owner's OK to download asset packs) | ⬜ | |
| R5-08 | P1 | Volumetric (ray-marched) cumulus on High: half-res march (≈0.5 MP) through a 1150–3400 m slab, weather map × height profile × 64³ Perlin-Worley noise, sun march + two-lobe phase + ambient, height haze per sample, stops at scene depth (log-depth decode), fly-through, wind drift, storm darkening; Low (phones) keeps the billboard puffs | ✅ | `src/engine/volumetricClouds.ts`, 5 tests; checked at noon / sunset / above / storm. Needs an fps check on a real desktop GPU (headless shots use software rendering) |
| R5-09 | P1 | Roads, rivers, town street grids | ⬜ | |
| R5-10 | P1 | Step 2: one real-world region (open elevation + Sentinel-2 imagery + OpenStreetMap) via WorldProvider | ⬜ | Owner to pick the region |
| R2-07 | P5 | Token purchase for premium Maydays | ⛔ | Blocked on the Senevon connection (P5); items listed in SENEVON_INTEGRATION.md §7 |
| P2-01 | P2 | Kestrel, Otter (wheels + floats), Heron configs + models | ✅ | Plus the Falcon J5 (see R4-01) |
| P2-02 | P2 | Cockpit instruments (canvas gauges) | ⬜ | |
| P2-03 | P2 | Engine, wind and gear audio | ⬜ | |
| P2-04 | P2 | Crash detection + crash sequence | ⬜ | |
| P2-05 | P2 | Water physics (floats) | ✅ | See R4-02 |
| P2-06 | P2 | Free Flight mode + menu | ⬜ | |
| P2-07 | P2 | Rewind 10 s | ✅ | Done in R1 |
| P3-01 | P3 | App state machine + menus (Preact) | ⬜ | |
| P3-02 | P3 | Flight School: 5 lessons + check ride | ⬜ | |
| P3-03 | P3 | Mission framework (objectives, triggers, briefing, results) | ⬜ | |
| P3-04 | P3 | Missions: ferry, passenger, cargo, bush, sightseeing, race | ⬜ | |
| P3-05 | P3 | Score screen with landing card + count-up juice | ⬜ | |
| P3-06 | P3 | Credits, XP, ranks, licenses, hangar | ⬜ | |
| P3-07 | P3 | Local save (IndexedDB) + logbook | ⬜ | |
| P4-01 | P4 | Tilt control + calibration | ⬜ | |
| P4-02 | P4 | Touch stick, throttle slider, buttons, haptics | ⬜ | |
| P4-03 | P4 | Quality presets + auto benchmark + dynamic resolution | ⬜ | |
| P4-04 | P4 | Low-end Android test pass (≥ 30 fps) | ⬜ | |
| P5-01 | P5 | `integration/` drafts: skyward.sql, game_signin & shop changes, catalog entry | ⬜ | Owner applies them in 7games |
| P5-02 | P5 | senevon.ts (sign-in hand-off, state, buy) | ⬜ | |
| P5-03 | P5 | Cloud save sync + guest merge | ⬜ | |
| P5-04 | P5 | Token shop UI in the hangar | ⬜ | |
| P5-05 | P5 | submit_score('skyward') main leaderboard | ⬜ | |
| P6-01 | P6 | Daily Challenge generator + board + streak | ⬜ | |
| P6-02 | P6 | Ghost record/encode/upload/playback | ⬜ | |
| P6-03 | P6 | Fixed challenges (crosswind, short-field, glide, rings) | ⬜ | |
| P6-04 | P6 | Weekly league | ⬜ | |
| P6-05 | P6 | Achievements (~60) | ⬜ | |
| P7-01 | P7 | Weather presets, rain, night lighting | ⬜ | |
| P7-02 | P7 | Replay + cinematic cameras + photo mode + share card | ⬜ | |
| P7-03 | P7 | Highland Valley + Metro Bay regions; Heron/Pelican missions | ⬜ | |
| P7-04 | P7 | Analytics events, error logging | ⬜ | |
| P7-05 | P7 | render.yaml + Render static deploy | ⬜ | |
| P7-06 | P7 | Poster/art for the Senevon catalog; listing applied by the owner | ⬜ | |
| P8-01 | P8 | Real-world provider (3d-tiles-renderer + Google/Cesium tiles) | ⏸ | Needs API key + cost plan |
| P8-02 | P8 | Live multiplayer | ⏸ | Needs a realtime approach (Supabase Realtime?) |
| P8-03 | P8 | Ranger H1 helicopter | ⏸ | |
| P8-04 | P8 | Android app (Capacitor) | ⏸ | |

---

## Decisions log

| Date | Decision | Why |
|------|----------|-----|
| 2026-11-23 | Sim-lite realism with layered assists | Widest audience, most addictive |
| 2026-11-23 | Procedural world first; real-world tiles in a later phase behind `WorldProvider` | Light on phones, no API cost at launch, future-proof |
| 2026-11-23 | All hooks: career, daily + leaderboards, token shop, ghosts (live multiplayer later) | Owner choice |
| 2026-11-23 | Desktop and mobile developed together | Owner choice |
| 2026-11-23 | Three.js + custom flight model + Preact UI + Vite static on Render | Light, fits Senevon's stack and 3D Tiles later |
| 2026-11-23 | Building P0 with default answers to the open questions (changeable) | Owner said "next" |
| 2026-11-23 | Keyboard pitch: W/↑ = nose down, S/↓ = nose up (sim convention); an invert option comes with settings in P3 | Standard for flight sims |
| 2026-11-23 | Easy/Normal use fly-by-wire style rate/attitude command instead of direct surfaces | Owner: "controls are crap"; keyboard input slammed the elevator |
| 2026-11-23 | Throttle down moved from Ctrl to Z | Ctrl+W closes the browser tab |
| 2026-11-23 | No floating origin yet: three.js builds model-view matrices in float64 on the CPU and chunk vertices are chunk-local, so there is no jitter at a 65 km scale. Revisit for the real-world (ECEF) phase | Simpler; same result at this scale |
| 2026-11-23 | Airports sited by an automated search (flat pad + clear 3° approaches both ways) | First hand-placed sites sat on 100–400 m hills, and one approach went through a hill |
| 2026-11-23 | Wheels touching the sea = ditching crash | Floats arrive with the Otter (P2) |
| 2026-11-23 | Owner's reference screenshots (a commercial sim) used for direction only; HUD, instruments and map are Skyward's own design | Originality |
| 2026-11-23 | Touch layout: instruments to the top corners, thumbs own the bottom; quality defaults to Battery saver on phones | Mobile-first usability and performance |
| 2026-11-23 | Weather is free; Mayday scenarios are premium (one free) | Owner asked for token-purchasable Maydays; weather is a core setting |
| 2026-11-23 | No fake purchases: locked items explain that tokens open with the Senevon connection; dev-only unlock switch for testing | Honest UX until P5 |
| 2026-11-24 | All five aircraft flyable for free for now | No credits economy yet; unlock rules (details.md §8) apply once P3/P5 land |
| 2026-11-24 | Autopilot hands over at 200 ft minimums instead of autolanding | The landing is the game's core skill and score |
| 2026-11-24 | Time acceleration only above 500 ft AGL | Landings and takeoffs stay real-time and fairly scored |
| 2026-11-24 | Aircraft models from open-licence sources (CC0 / CC-BY only), owner's choice; coded models stay as fallback | Owner wants open-source models; no NC/GPL/editorial licences for a token-selling game |
| 2026-11-24 | Stay on three.js rather than move to Godot | Godot's web export only runs its simpler Compatibility renderer and would mean a rewrite; three.js add-ons give the same effects in the browser |
| 2026-11-24 | Haze is height-based (scale height 1.1 km) and set by visibility (2.6 / visibility) | Mountain tops above the haze stay crisp; matches how real haze works |
| 2026-11-24 | Glare and MSAA on High only; Low renders straight to screen | Mobile performance budget |
| 2026-11-24 | Volumetric clouds on High only, rendered at ≈ 0.5 MP and laid over the frame before glare; Low keeps billboards | Ray marching is too heavy for the phone budget; a fixed pixel count keeps cost flat on 4K / high-DPR screens |
| 2026-11-24 | Cloud march samples textures with explicit LOD | Implicit mip selection is undefined inside the divergent march loop and showed as striped clouds |
| 2026-11-23 | Integrate like DroidDoom (external game, sign-in hand-off, `sw:` shop items); never edit 7games | Owner rule + existing pattern |

## Playtest log

| Date | Build | Tester | Notes |
|------|-------|--------|-------|
| — | — | — | — |

## Change log

| Date | Change |
|------|--------|
| 2026-11-23 | Pre-production documents created |
| 2026-11-23 | P0 flight prototype: sim, tests, scene, HUD, audio, input |
| 2026-11-23 | Controls rework (fly-by-wire assists, mouse flying, invert, key changes) |
| 2026-11-23 | P1: Coral Coast procedural world (terrain streaming, ocean, clouds, scenery, 7 airports, time of day) |
| 2026-11-23 | R1: realism pass, new HUD & instruments, moving map, menu, mobile controls, autopilot, rewind, cameras, radio |
| 2026-11-24 | R5-08: volumetric clouds on High (116 tests) |
| 2026-11-24 | Favicon + apple-touch-icon from `public/icon/snv-air-icon.png` (cropped square, 32/180/512 px) |
| 2026-11-24 | R7: GLB aircraft model pipeline + open-licence shortlist |
| 2026-11-24 | R6: phone blank-screen fix, responsive portrait + landscape touch layout |
| 2026-11-24 | R5: realistic graphics step 1 (haze, glare, shadows, ocean surf, ground surfaces, colour fixes), screenshot harness (107 tests) |
| 2026-11-24 | R4: four new aircraft with their systems, parametric models, hangar (104 tests) |
| 2026-11-24 | R3: rigging + takeoff fix, real-aircraft control details, full autopilot, time acceleration (56 tests) |
| 2026-11-24 | R2.2: adaptive (dynamic) HUD contrast |
| 2026-11-24 | R2.1: transparent HUD, round 2 % frosted gauges |
| 2026-11-23 | R2: glass HUD, taxi steering fix, mobile refinement, weather system, cloud/tree/building/farmland visuals, Mayday scenarios |
