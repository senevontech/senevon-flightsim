# Skyward (working title)

A realistic-feeling browser flight simulator for **Senevon Games**: sim-lite physics, short
missions, a landing score you'll want to beat, and daily challenges. Runs on desktop and mobile.

> Status: **pre-production**. Documents only; the code scaffold comes next (PROGRESS.md → P0).

## Documents

| File | What's in it |
|------|--------------|
| [details.md](details.md) | Game design document: pitch, pillars, loops, modes, aircraft, world, controls, open questions |
| [PROGRESS.md](PROGRESS.md) | Phases, task sheet, decisions log, playtest log |
| [docs/FLIGHT_MODEL.md](docs/FLIGHT_MODEL.md) | Physics: aero surfaces, engines, gear, assists, landing score |
| [docs/TECH_ARCHITECTURE.md](docs/TECH_ARCHITECTURE.md) | Stack, folder layout, terrain, rendering, input, saves, ghosts, deploy |
| [docs/GAMEPLAY_AND_ECONOMY.md](docs/GAMEPLAY_AND_ECONOMY.md) | Ranks, licenses, credits, prices, daily/weekly, achievements |
| [docs/SENEVON_INTEGRATION.md](docs/SENEVON_INTEGRATION.md) | How the game connects to the Senevon Supabase server (DroidDoom pattern) |
| [docs/ASSETS.md](docs/ASSETS.md) | Art/audio rules, budgets, sources, asset register |

## Stack

TypeScript · Vite · Three.js · Preact · Supabase (Senevon's project) · a static site on Render.

## Hosting

The game builds to a static `dist/` and is deployed as a Render static site. Accounts, tokens,
the shop and leaderboards come from the existing Senevon Supabase project. The parent repo
`E:\s15\games\7games` is **not modified** from here. Senevon-side changes are drafted in
`integration/` for the owner to apply.
