# Gameplay, Progression & Economy

All numbers here are **starting values** for balancing. Change them freely during playtests and
log the changes in PROGRESS.md → Decisions.

## 1. Currencies

| Currency | Earned / bought | Used for | Where it's stored |
|----------|-----------------|----------|-------------------|
| **XP** | Every flight | Pilot rank | Save (cloud when signed in) |
| **Credits (CR)** | Missions, daily, achievements | Aircraft, upgrades, liveries, repairs | Save (cloud when signed in) |
| **Senevon tokens** | Bought on Senevon (or from Senevon rewards) | Early unlocks, premium liveries, premium regions | **Senevon only** (server) |

Senevon Plus / Pro / unlimited → every `sw:` shop item unlocked (the same rule as DroidDoom).

## 2. Pilot rank and licenses

- XP to the next rank: `100 × rank^1.5` (rank 1→2 = 100 XP, 10→11 ≈ 3,160 XP, 49→50 ≈ 34,300 XP).
- Typical flight: 60–250 XP. Early ranks come every 1–2 flights; late ranks take a session.

| License | Requirement | Unlocks |
|---------|-------------|---------|
| Student | Start | Sparrow, Coral Coast, ferry and passenger missions |
| Private | Rank 3 + Flight School check ride | Cargo, sightseeing, Kestrel (buyable) |
| Bush | Rank 6 + 3 short-field landings ≥ SMOOTH | Otter, Highland Valley, bush and water missions |
| Commercial | Rank 12 + check ride (twin, engine-out) | Heron, Pelican, medevac, SAR, firefighting |
| Airline | Rank 25 + check ride (night ILS-style) | Falcon, Condor, Metro Bay airline routes |
| Ace | Rank 40 + 25 BUTTER landings | Hornet free, gold liveries, "Ace" badge on leaderboards |

## 3. Mission payout

```
credits = base(mission type, distance) × aircraftClassMultiplier
        + starBonus (0 / 20% / 50% / 100% of base for 0–3 stars)
        + landingBonus (score/1000 × 30% of base)
        + tips (passenger comfort, random 0–25%)
        × eventMultiplier (priority cargo ×3, rare, ~5% of missions)
```

Starting bases: ferry 300, passenger 400, cargo 450, bush 600, medevac 800, SAR 900, firefight 1000.

## 4. Prices (credits / tokens placeholders)

| Item | Credits | Tokens (Senevon) |
|------|---------|------------------|
| Kestrel K2 | 15,000 | 1,200 |
| Otter B4 (+ floats) | 25,000 | 1,800 |
| Heron T2 | 60,000 | 3,000 |
| Pelican A1 | 80,000 | 3,500 |
| Falcon J5 | 150,000 | 5,000 |
| Condor 320 | 300,000 | 8,000 |
| Hornet T7 | 120,000 (or Ace) | 4,500 |
| Standard livery | 2,000–8,000 | — |
| Premium livery | — | 300–800 |
| Premium region (later) | — | 2,000 |

Licenses still gate *career missions* for an aircraft bought early with tokens. The aircraft is
flyable in Free Flight and Challenges right away. This keeps the token purchase valuable without
letting players skip progression entirely.

## 5. Daily & weekly

- **Daily Challenge:** generated from `seed = hash(date)`. Picks an airport, wind and gusts,
  weather, time of day and aircraft, and a type (landing / short-field / ring course / glide).
  Unlimited attempts; the best attempt counts. Reward: 500 CR on the first finish, plus rank
  tiers (top 10% / 25% / 50%).
- **Streak:** consecutive days with at least one daily attempt. Bonus credits rise to 7 days and
  then stay level. One "streak freeze" is earned every 7 days.
- **Weekly League:** a ring-course race with a fixed aircraft. Race against ghosts; league tiers
  Bronze → Silver → Gold → Platinum → Ace; promotion or relegation every Monday.
- **Reset time:** 00:00 UTC by default (open question in details.md).

## 6. Achievements (examples, about 60 at launch)

First Flight · Butter Bread (first BUTTER) · Ten Butters · Crosswind King (BUTTER in a ≥ 15 kt
crosswind) · Dead Stick (land after an engine failure) · Island Hopper (land at 10 island
airports) · Night Owl · Wet Feet (first water landing) · Firefighter · Globetrotter (visit 50
airports) · Logbook 10/100 h · Streak 7/30/100 · League Ace · No Rewind (a mission rated 3 stars
on Real).

Achievements give credits and appear on the Senevon profile later, if Senevon's achievement grid
supports external games.

## 7. Engagement guardrails

- No energy or stamina timers that block play.
- No loot boxes. Tokens always buy a known item.
- A crash costs time only (plus repair credits on Real mode); it never costs progress.
- The daily and weekly loops reward participation, not grinding.
