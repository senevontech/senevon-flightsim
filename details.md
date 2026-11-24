# Skyward — Game Design Document (details.md)

> **Working title:** *Skyward* (game id `skyward`). Rename any time; the id is used in Senevon
> leaderboards and the shop, so settle the final name before Phase 5.
> **Status:** Pre-production (documents only). Last updated 2026-11-23.

---

## 1. One-line pitch

A realistic-feeling flight simulator in the browser: real aerodynamics, short satisfying flights,
and a landing score you'll want to beat "just one more time". Playable on desktop and phones, and
signed in with your Senevon account.

## 2. Design pillars

| # | Pillar | What it means in practice |
|---|--------|---------------------------|
| 1 | **Feels real, plays easy** | Real lift, drag, stall, torque, ground effect and wind. Assists are on by default and can be switched off one at a time. A new player is flying within 30 seconds, and a skilled player is still improving after 30 hours. |
| 2 | **Every flight ends with a score** | Each flight is graded: landing score, mission stars, coins and XP. A flight lasts 3–8 minutes. |
| 3 | **Always one goal away** | The next unlock, rank, license or daily rank is always visible and always close. |
| 4 | **Fair and skill-based** | Leaderboards are decided by skill only. Tokens buy convenience and cosmetics, and every aircraft can also be earned. |
| 5 | **Runs anywhere** | Mid-range Android phones run at 30+ fps and desktops at 60+ fps. The first flight loads in under 10 seconds on 4G. |

## 3. Target audience

- **Primary:** casual and mid-core players aged 13–35 on Senevon (India-first, global). They are
  curious about flying but put off by "hard" sims.
- **Secondary:** aviation fans who want a quick browser fix with real physics and competitive
  landing scores.
- **Devices:** desktop browsers (keyboard, mouse, gamepad, joystick) and mobile browsers (tilt and
  touch). An Android app wrapper comes later.

## 4. Why it's addictive (the engagement design)

1. **Short core loop with a grade at the end.** Take off, fly the mission, land, then see a big
   animated score. Restart is instant and needs no menus.
2. **The landing score is the hook.** Touchdown vertical speed, g-force, centerline and
   touchdown zone give a 0–1000 score and a grade (BUTTER / SMOOTH / FIRM / HARD / CRASH). The
   result is easy to read, easy to share, and there's always room to improve.
3. **Variable rewards.** Random weather events, passenger tips for a smooth ride, rare
   "priority cargo" with 3× payout, and surprise system failures on higher ranks.
4. **Constant visible progress.** XP bar → pilot rank (1–50) → licenses unlock aircraft classes
   → new regions and airports. Some unlock arrives every 2–3 flights early on, then every 4–6.
5. **Daily ritual.** One Daily Challenge with the same seed, weather and airport for everyone, a
   daily leaderboard and a streak counter. A Weekly Race League uses ghosts.
6. **Social pressure without toxicity.** Race your friends' ghosts, beat their landing score,
   and share a landing card image.
7. **Collection itch.** Pilot logbook (hours, landings, airports visited), achievements, a hangar
   of aircraft and liveries.
8. **No frustration walls.** *Rewind 10 s* (limited per flight on harder modes), checkpoints on
   long missions, and crashes that are funny and quick rather than punishing.
9. **Juice.** Slow-motion replay of a butter landing with a camera cut, screen-shake on a hard
   landing, tyre smoke, satisfying UI sounds, and a coin count-up.

## 5. Core loops

```
MICRO (seconds)     fly → correct → feel the aircraft respond → near-miss / perfect flare
FLIGHT (3–8 min)    pick mission → take off → objective → approach → LAND → score screen
SESSION (15–30 min) 3–5 flights → coins + XP → rank up / unlock → try the new thing
META (days/weeks)   daily challenge + streak → weekly league → licenses → full hangar → regions
```

## 6. Game modes

| Mode | Description | Phase |
|------|-------------|-------|
| **Tutorial / Flight School** | Five bite-size lessons: controls, takeoff, turns, approach, landing. Each lesson ends with a license check ride. | P3 |
| **Career** | Pilot rank, licenses, missions on a regional map, earning coins. The main progression. | P3 |
| **Free Flight** | Any unlocked aircraft, airport, time and weather. No score. | P2 |
| **Daily Challenge** | A seeded scenario (airport + wind + weather + aircraft), the same for everyone. Daily leaderboard. | P6 |
| **Challenges** | Fixed scenarios: crosswind landings, short-field, carrier-style, engine-out glide, ring courses. Each has a leaderboard. | P6 |
| **Ghost Race / League** | Async races against friends' or top players' ghosts. A weekly league resets on Monday. | P6 |
| **Live multiplayer** | Shared sky, formation flying and races. | Later (P8) |

## 7. Missions (Career)

| Type | Twist | Unlocks at |
|------|-------|-----------|
| Ferry flight | Move a plane from A to B | Rank 1 |
| Passenger charter | Comfort meter: g-forces and turbulence reduce the tip | Rank 2 |
| Cargo | Weight and balance change performance; fragile cargo needs smooth landings | Rank 3 |
| Bush delivery | Short dirt strips on hills; tight approaches | Private license |
| Sightseeing tour | Fly over marked landmarks at a low, safe altitude | Rank 4 |
| Medevac | Time pressure balanced against a smooth ride | Commercial license |
| Search & rescue | Spot flares or smoke and circle to mark the spot | Commercial license |
| Aerial firefighting | Amphibian: scoop water from a lake and drop it on the fire line | Commercial license |
| Water operations | Floatplane landings on lakes and the sea | Bush license |
| Emergency | Engine failure, gear problems, low fuel: glide and land | Rank 10+ |
| Air race | Rings and gates against the clock or ghosts | Rank 5 |
| Night mail | Night flight with runway lights and instruments | Airline license |

**Mission rating:** up to 3 stars from objective, time, comfort and landing score.
**Payout:** base pay plus a star bonus plus the landing bonus plus random tips.

## 8. Aircraft roster (original designs, not real brands)

| Aircraft | Class | Role / feel | Unlock |
|----------|-------|-------------|--------|
| **Sparrow S1** | Single-piston high-wing trainer | Stable, forgiving, slow. The starter plane | Free |
| **Kestrel K2** | Aerobatic single | Snappy roll, inverted capable | Rank 5 or tokens |
| **Otter B4** | Bush plane / floatplane variant | STOL, big wings, tundra tyres or floats | Bush license |
| **Heron T2** | Twin turboprop commuter | 12 passengers, asymmetric thrust if an engine fails | Commercial license |
| **Pelican A1** | Amphibian water bomber | Water scoop and drop | Commercial license |
| **Falcon J5** | Light business jet | Fast; needs energy management | Airline license |
| **Condor 320** | Narrow-body airliner | Heavy; long approaches; autopilot | Airline license, Rank 30 |
| **Hornet T7** | Jet trainer | Fast, agile, fun for races | Rank 20 or tokens |
| **Ranger H1** | Light helicopter | A separate flight model | Later (P8) |

Each aircraft has a config file (mass, wing, engine, gear, camera points) and 3–6 liveries.
The launch target is **4 aircraft** (Sparrow, Kestrel, Otter, Heron). The rest arrive in updates,
which is also good for retention.

## 9. World

### Phase 1 (launch): procedural world with landmark regions
- A seeded procedural planet slice: around 200 × 200 km per region, streamed in chunks.
- Terrain: mountains, hills, plains, coastlines, islands, lakes and rivers, from noise with
  ridges and erosion-like shaping.
- Biomes: tropical coast, green farmland, desert, alpine snow, tundra.
- Airports are generated with rules (runway length matches the aircraft class) and the terrain is
  flattened around them. Some are hand-tuned "hero" airports.
- Instanced cities and towns, forests, roads (later), and landmark props (lighthouse, dam, bridge,
  radio mast, volcano).
- **Launch regions:** (1) *Coral Coast* — tropical islands, the starter region; (2) *Highland
  Valley* — mountains and lakes, bush flying; (3) *Metro Bay* — a big city with an international
  airport, airline flying.

### Phase 2 (later): real-world mode
- Real Earth terrain and photorealistic 3D cities through streamed 3D Tiles (Google
  Photorealistic 3D Tiles or Cesium ion), rendered in the same Three.js engine with
  `3d-tiles-renderer`.
- Real airports from OpenStreetMap / OurAirports data.
- Probably sold as a premium "World Pass" or included with Senevon Plus to cover tile API costs.
- **Rule from day 1:** all world access goes through a `WorldProvider` interface, so the real-world
  provider plugs in without rewriting gameplay.

## 10. Flight model (sim-lite)

See [docs/FLIGHT_MODEL.md](docs/FLIGHT_MODEL.md). Summary:
- A rigid body with six degrees of freedom, a fixed 120 Hz physics step and quaternion orientation.
- Forces are computed per surface (wings, tail, fin): angle of attack → lift and drag curves with
  stall, flaps, ground effect.
- Engines: piston with propeller (torque, P-factor, power drops with altitude), turboprop, jet
  (spool-up lag).
- Standard-atmosphere air density, wind, gusts, turbulence and thermals near terrain.
- Landing gear as spring-dampers with friction, brakes, nose-wheel steering and floats on water.
- **Assists (on by default, each can be turned off):** auto-coordination (rudder), stall
  protection, bank limiter, auto-trim, speed hold, approach guidance ribbon, rewind.
- Difficulty presets: **Easy / Normal / Real**. Leaderboards show which preset was used, and some
  challenges require *Real*.

## 11. Controls

| Device | Scheme |
|--------|--------|
| Keyboard | W/S pitch, A/D roll, Q/E rudder, Shift/Ctrl throttle, F/V flaps, G gear, B brakes, C camera, R rewind, P pause |
| Mouse | Optional "mouse yoke" (the cursor sets pitch and roll) with free-look on right-drag |
| Gamepad | Left stick pitch/roll, triggers rudder, right stick look, bumpers throttle; remappable |
| Joystick / HOTAS | Through the Gamepad API with an axis-mapping screen and calibration |
| Mobile | **Tilt** (device orientation, calibrated to how the player holds the phone) or an **on-screen stick**; throttle slider; buttons for flaps, gear, brake, camera and rewind; haptics on touchdown |

Cameras: chase, cockpit (looking around with drag or head movement), wing, tower, orbit/free,
and cinematic replay.

## 12. HUD & cockpit

- **Simple HUD (default):** airspeed, altitude, vertical speed, heading tape, throttle, flaps,
  gear, a stall warning bar, mission objective arrow and an approach ribbon.
- **Cockpit:** six main gauges for the piston planes, a simplified glass cockpit for the jets.
  The instruments are drawn with live canvas textures.
- **Landing panel:** on touchdown, a big number with vertical speed in fpm, g-force,
  centerline offset and grade.

## 13. Progression & economy (summary)

See [docs/GAMEPLAY_AND_ECONOMY.md](docs/GAMEPLAY_AND_ECONOMY.md).
- **XP → Pilot Rank 1–50.** Licenses: Student → Private → Bush → Commercial → Airline → Ace.
- **Credits (in-game soft currency):** earned from missions. They buy aircraft, upgrades,
  liveries and fuel/repairs on harder modes.
- **Senevon tokens (premium):** unlock an aircraft early, premium liveries, premium regions,
  and later the World Pass. **Senevon Plus / Pro / unlimited = everything unlocked**, following
  the DroidDoom model.
- Nothing bought improves leaderboard performance (all aircraft in a given challenge are fixed).

## 14. Art & audio direction

- **Visual style:** "stylised realism". The lighting, atmosphere and water are realistic; the
  models are low-to-mid poly with clean materials. This scales well to phones and ages well.
- Golden-hour lighting is the signature look. Dynamic time of day, volumetric-looking clouds,
  fog that fades into the distance.
- **Audio:** layered engine loops that follow RPM, wind noise that rises with airspeed, a stall
  horn, gear clunk, tyre squeak, a few radio-style callouts ("Fifty… thirty… ten"), and calm
  ambient menu music.
- See [docs/ASSETS.md](docs/ASSETS.md) for sources and budgets.

## 15. Platform, hosting & Senevon

- **Build:** a fully static site (Vite). Hosted as a **Render static site**
  (e.g. `skyward.onrender.com`).
- **Backend:** the existing **Senevon Supabase project**, for accounts, tokens, Plus, the shop,
  leaderboards and cloud saves. The game has no server of its own.
- Listed in Senevon's catalog as an external game (`kind: "iframe"`, `signIn: true`), like
  DroidDoom.
- **Rule: the parent repo `E:\s15\games\7games` is never modified from this project.** All
  Senevon-side changes are drafted in [docs/SENEVON_INTEGRATION.md](docs/SENEVON_INTEGRATION.md)
  and `integration/` for the owner to apply.

## 16. Tech stack (decided)

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript (strict) | Same as Senevon |
| Build | Vite 7 | Same as Senevon; static output |
| 3D | Three.js (WebGL2; WebGPU later) | Mature, light, and works with `3d-tiles-renderer` for the real-world phase |
| Physics | Custom flight model (no general physics engine) | We need aerodynamics, not stacking boxes |
| Menus / UI | Preact + signals (about 4 KB) over the canvas | Rich menus without React's weight in the game |
| Workers | Web Workers for terrain generation | Keeps the frame rate smooth |
| Backend | `@supabase/supabase-js` against the Senevon project | Shared accounts, tokens, leaderboards |
| Tests | Vitest for flight-model and scoring maths | Physics regressions are easy to make |

Full details: [docs/TECH_ARCHITECTURE.md](docs/TECH_ARCHITECTURE.md).

## 17. Performance budgets

| Metric | Mobile (mid Android) | Desktop |
|--------|----------------------|---------|
| Frame rate | ≥ 30 fps (target 60) | ≥ 60 fps |
| Draw calls | ≤ 150 | ≤ 400 |
| Triangles on screen | ≤ 500 k | ≤ 2 M |
| First download (to first flight) | ≤ 8 MB | ≤ 8 MB |
| Total memory | ≤ 400 MB | ≤ 1 GB |
| Load to cockpit | ≤ 10 s on 4G | ≤ 5 s |

Graphics presets: Low / Medium / High / Ultra, auto-picked by a quick benchmark on first run.

## 18. Monetization (fits the Senevon business model)

- Token purchases on Senevon: early aircraft, liveries, premium regions, World Pass (later).
- Senevon Plus: everything unlocked, plus a daily credits bonus.
- Optional rewarded ad: "double this flight's credits". It's only offered on the score screen,
  never during a flight. The ad flow uses Senevon's rewarded-ad system and comes later.
- No ads in the cockpit and no pay-to-win.

## 19. Risks

| Risk | Mitigation |
|------|-----------|
| Flight model feels floaty or "gamey" | Prototype first (P0), tune against real performance numbers, playtest early |
| Mobile performance | Budgets from day 1, LOD everywhere, quality presets, testing on a real low-end device |
| Tilt controls feel bad | Calibration, dead-zones, response curves, a stick fallback, assists |
| Large-world float precision (jitter far from origin) | Floating origin from day 1 |
| 3D model asset cost | Original low-poly models; CC0 sources for props (see ASSETS.md) |
| Leaderboard cheating | Server rate and range checks; store ghost replays for later checking |
| Real-world tile API cost | Phase 2 only; paid feature; caching; quota alarms |

## 20. Open questions (for the owner)

1. Final game **name** and logo.
2. **Daily reset time:** 00:00 UTC (global fairness) or 00:00 IST (India-first)? Default: UTC.
3. **Aircraft 3D models:** made in Blender by us/you, commissioned, or CC0 bases (see ASSETS.md)?
4. **Render service name / domain** (e.g. `skyward.onrender.com` or a subdomain of `senevon.in`).
5. Should Free Flight be available to guests (signed out)? Default: yes, with career progress kept
   on the device.
6. Token **prices** for aircraft and liveries (placeholders are in GAMEPLAY_AND_ECONOMY.md).
