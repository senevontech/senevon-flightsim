# Flight Model — Sim-lite

The heart of the game. If flying doesn't feel good in Phase 0, nothing else matters.

## 1. Goals

- Behaviour that is believable to a pilot: stalls, spins (Real mode), ground effect, the left
  turning tendency from the propeller, energy management, crosswind crab and de-crab.
- Forgiving by default, using **assists** layered on top of the same physics (never a different
  "easy physics").
- Deterministic for a given input stream and seed, so ghosts and replays reproduce exactly
  (fixed timestep, no frame-rate-dependent maths).
- Cheap: well under 1 ms per step on mobile for the player's aircraft. Ghosts are not simulated;
  they are played back.

## 2. Integration

- Fixed timestep **120 Hz** (dt = 1/120 s), run from an accumulator in the render loop. The
  renderer interpolates between the last two states.
- State: position (double-precision world coordinates, see floating origin), velocity, orientation
  quaternion, angular velocity, engine state, fuel, gear/flap positions.
- Integrator: semi-implicit (symplectic) Euler. Switch to RK2 if stiffness becomes an issue (the
  gear springs are the usual culprit; extra substeps during ground contact are allowed).
- Body frame (matches Three.js objects): +X right, +Y up, −Z forward (nose); origin = CG.
  World frame: +X east, +Y up, −Z north. Heading 0° = north, increasing clockwise.
- Sign conventions (code: `src/sim/aircraft.ts`): + pitch input = nose up, + roll = right,
  + yaw = right. Angular velocity `w` is in the body frame: `w.x` + = nose up, `w.y` + = nose
  left, `w.z` + = roll left.

## 3. Atmosphere

- International Standard Atmosphere: temperature, pressure and density as functions of altitude;
  optional temperature offset per weather preset.
- Wind: base vector by altitude layer, gusts (smoothed noise), turbulence (Dryden-style filtered
  noise, scaled by weather), wind shear near the ground, ridge lift on mountains and thermals
  over land on hot days.

## 4. Aerodynamics

Each aircraft is a set of **lifting surfaces** (left wing, right wing, horizontal tail, vertical
fin, optional canard). For each surface, every step:

1. Local airflow = −(aircraft velocity + angular velocity × surface offset − wind).
2. Angle of attack α and sideslip β in the surface's frame.
3. Lift coefficient CL(α) from a curve: linear section (slope ≈ 2π·AR/(AR+2)) → soft peak at
   CLmax → post-stall drop to a flat-plate model. Flaps raise CL0 and CLmax and add drag.
4. Drag: CD = CD0 + CL²/(π·e·AR) + flap/gear/spoiler drag.
5. Control surface deflection (aileron, elevator, rudder) changes the surface's camber, i.e.
   shifts CL and adds a little drag.
6. Ground effect: induced drag reduced and lift increased below about one wingspan of height.
7. Force = ½ρV²·S·C at the surface's aerodynamic centre → total force and torque on the body.

Plus fuselage drag, and a damping term per axis (pitch, roll, yaw) tuned per aircraft so
handling feels right without hand-tuning every surface.

Stall and spin: because each wing is evaluated separately, an uncoordinated stall drops a wing
naturally. Real mode allows spins; Easy and Normal limit α through stall protection.

## 5. Propulsion

| Type | Model |
|------|-------|
| Piston + propeller | Power(rpm, throttle, density); propeller thrust from an efficiency curve against advance ratio; torque reaction (roll), P-factor and slipstream (yaw) scaled by power and α |
| Turboprop | As piston, with a slower power response and a beta range for reverse |
| Jet | Thrust(throttle, Mach, density) with a first-order spool lag (about 3–6 s from idle) |

Fuel burn as a function of power. Engine failure events can be triggered by missions.

## 6. Ground and water

- Each wheel is a raycast down along the strut → spring-damper force → tyre friction (lateral
  grip curve plus rolling resistance plus brakes). The nose or tail wheel steers.
- Surface types: asphalt, grass, dirt, gravel, snow and water, each with its own friction and
  rolling drag.
- Floats: buoyancy as a function of submerged volume (sampled points), water drag, and a "step"
  where hydro drag drops as the floats plane on the water.
- Crash detection: wing or fuselage contact points, a g-limit, or a vertical-speed limit. A crash
  starts a fun, quick crash sequence and keeps the replay.

## 7. Assists: a small fly-by-wire layer (`src/sim/assists.ts`)

The pilot's stick never moves the surfaces directly in Easy/Normal. It *commands* a response,
and PI controllers (gains scaled by airspeed) move the surfaces to achieve it.

| | Easy | Normal | Real |
|---|---|---|---|
| Pitch | Rate command (9°/s); release = nose stays put | Rate command (14°/s); release = holds | Direct (response curve) |
| Roll | Bank command (to 50°); release = wings level | Rate command (55°/s); release = holds the bank (< 6° drifts level) | Direct |
| Turn coordination (rudder) | ✔ | ✔ | — |
| Level turns without pulling | ✔ (auto back-pressure) | ✔ | — |
| g limit | 2.2 g / 0 g | 3.2 g / −0.8 g | none (airframe limits apply) |
| Stall protection | hard (3° margin) | soft (1° margin) | — |
| Approach rings | ✔ | ✔ | — |

On the ground every preset uses direct elevator (for rotation) and the rudder steers the nose wheel.

Handling is locked in by `src/sim/__tests__/handling.test.ts`. It flies keyboard step inputs
and checks bank capture, levelling time, overshoot, pitch hold, altitude in turns, stall and g.

**Input rules:** no Ctrl bindings (browser shortcuts such as Ctrl+W close the tab). Mouse
flying (Y) uses the cursor's offset from the screen centre as the stick. Pitch can be inverted
(I). All preferences are saved locally.

## 8. Aircraft config (data, not code)

Every aircraft is described by a JSON file in `src/aircraft/<id>.json`:

```jsonc
{
  "id": "sparrow-s1",
  "mass": { "empty": 760, "maxTakeoff": 1110, "fuelCapacity": 150, "cg": [0.1, 0, 0] },
  "inertia": [1300, 1800, 2700],
  "surfaces": [
    { "name": "wingL", "pos": [0.2, 1.1, -2.4], "area": 7.5, "span": 5.5, "chord": 1.5,
      "cl0": 0.3, "clMax": 1.5, "stallAoA": 16, "cd0": 0.02, "e": 0.8,
      "control": "aileronL", "flap": true }
    // wingR, hstab, vfin …
  ],
  "engine": { "type": "piston", "power": 120000, "propDiameter": 1.9, "maxRpm": 2700 },
  "gear": [ { "pos": [1.5, -1, 0], "stiffness": 60000, "damping": 4000, "steer": true } ],
  "limits": { "vne": 82, "gMax": 4.4, "gMin": -1.8, "flapSpeed": 45 },
  "cameras": { "cockpit": [0.6, 0.9, -0.3], "chase": [-12, 3, 0] }
}
```

Values are SI units (kg, m, N, W, m/s), with angles in degrees in the config.

## 9. Tuning targets (Sparrow S1, the reference aircraft)

| Property | Target |
|----------|--------|
| Stall (flaps up / full) | about 48 kt / 40 kt |
| Cruise at 75% power | about 110 kt |
| Climb at sea level | about 700 fpm |
| Takeoff roll | about 300 m |
| Landing best glide | about 65 kt, about 9:1 |

Each aircraft gets a **flight test checklist** in Vitest (`src/sim/__tests__/flight.test.ts`),
flown by the autopilot. This catches tuning regressions. Run `FLIGHT_LOG=1 npx vitest run` to
print the measured numbers.

Measured for the Sparrow S1 (2026-11-23):

| Test | Accepted range | Measured |
|------|----------------|----------|
| Cruise, 75% power, 300 m | 100–122 kt | 106.7 kt |
| Climb at Vy (74 kt), full power | 600–900 fpm | 714 fpm |
| Stall, flaps up | 44–53 kt | 50.6 kt |
| Stall, full flaps | 36–45 kt | 43.7 kt |
| Takeoff ground roll (rotate at 55 kt) | 200–400 m | 310 m |
| Rests on the gear | level, no drift | 1.0° nose-up, still |
| Hands-off 60 s | no divergence | slow left spiral (engine torque), realistic |

## 10. Landing score (detected in the gear model)

Captured at the first main-wheel contact:

| Factor | Ideal | Weight |
|--------|-------|--------|
| Vertical speed | −60 to −180 fpm | 40% |
| Peak g-force | ≤ 1.3 g | 15% |
| Centerline offset | < 1 m | 15% |
| Touchdown point | within ±150 ft of the aim point | 15% |
| Bank / crab at touchdown | < 2° / < 3° | 10% |
| Bounce | none | 5% (and a bounce caps the grade at FIRM) |

Score 0–1000 → grade: **BUTTER** ≥ 900, **SMOOTH** ≥ 750, **FIRM** ≥ 550, **HARD** ≥ 300,
**ROUGH** < 300, **CRASH** = 0. The scoring functions are pure and unit-tested.
