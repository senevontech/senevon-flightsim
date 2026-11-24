# Project rules — Skyward flight sim

- **Never modify `E:\s15\games\7games`** (the Senevon parent repo). Read it for reference only.
  Anything Senevon needs (SQL, catalog entry, secrets) is drafted in `integration/` and
  `docs/SENEVON_INTEGRATION.md` for the owner to apply.
- Integration follows the DroidDoom pattern: `7games/integrations/droiddoom/`.
- Only the **public** Supabase URL and anon key go in the client. Never the service-role key.
- Update `PROGRESS.md` (task status, decisions log, change log) whenever a task changes state.
- The flight model is data-driven (`src/aircraft/*.json`) and physics is a fixed 120 Hz step.
  Keep it deterministic (needed for ghosts and replays).
- All world access goes through `WorldProvider` (the procedural world now, real-world 3D Tiles
  later).
- Respect the performance budgets in details.md §17. Test on mobile as well as desktop.
- Original aircraft, names and liveries only. No real brands. Log every asset in docs/ASSETS.md.
- Pin exact dependency versions.
