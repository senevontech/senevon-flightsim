# Senevon Integration Plan

> **Rule:** this project never edits `E:\s15\games\7games`. This file and the `integration/`
> folder (created in Phase 5) hold everything the Senevon repo owner needs to apply.
> The pattern follows `7games/integrations/droiddoom/` exactly.

## 1. How the game connects (same as DroidDoom)

1. **Catalog entry** (Senevon `src/catalog.ts`), to be added by the owner:
   ```ts
   {
     id: "skyward",
     title: "Skyward",
     category: "Adventure",           // or a new "Simulation" category
     kind: "iframe",
     embedUrl: "https://skyward.onrender.com",
     signIn: true,
     difficulty: "Medium",
     minutes: 8,
     accent: "#3aa0ff",
     poster: "<cloudinary poster url>",
     description: "Fly real-feeling aircraft, nail the butter landing, and climb the pilot ranks.",
   }
   ```
2. **Sign-in hand-off:** Senevon opens the game with `#senevon_code=…` (a one-time code valid
   for 60 s). The game sends it to the `game-signin` Edge Function, gets a `token_hash` and calls
   `verifyOtp`. The player arrives signed in. "Sign in with Senevon" in the game goes to
   `SENEVON_URL/connect/skyward`.
3. **Shop:** items are `shop_items` with the `sw:` prefix. The game reads its state with
   `skyward_state()` and buys with `skyward_buy(item)`, both new RPCs modelled on
   `droiddoom_state` / `droiddoom_buy`.
4. **Plus / Pro / unlimited:** all access, using the same `_dd_all_access` logic
   (generalised or copied as `_sw_all_access`).

## 2. Changes the Senevon owner will need to apply (drafts arrive in `integration/`)

| # | Where | Change |
|---|-------|--------|
| 1 | `supabase/game_signin.sql` | Add `'skyward'` to `_game_signin_allowed()` |
| 2 | Edge Function secret | `GAME_SIGNIN_ORIGINS` = `https://droiddoom.onrender.com,https://skyward.onrender.com` (plus the local dev origin while testing) |
| 3 | `supabase/shop.sql` | Allow new kinds `sw_aircraft`, `sw_livery`, `sw_region`, `sw_mayday` in `shop_items_kind_check` |
| 4 | **new** `supabase/skyward.sql` | Shop items (`sw:aircraft_kestrel`, …), `skyward_state()`, `skyward_buy()`, `skyward_state` save table + `skyward_save()` RPC, daily/weekly runs table + RPCs |
| 5 | `src/catalog.ts` | The catalog entry above |
| 6 | Supabase Auth → Redirect URLs | Add `https://skyward.onrender.com` |
| 7 | (optional) `src/lib/scores.ts` | Nothing, unless a "lower is better" board is added (time trials) |

## 3. Data the game stores in Senevon's Supabase (draft design)

```sql
-- Cloud save (one row per player)
skyward_saves (user_id uuid pk, data jsonb, rev int, updated_at timestamptz)
  -- RLS: own row only; size cap ~64 KB; writes through skyward_save(p_data, p_rev)

-- Challenge / daily / league runs
skyward_runs (
  id bigserial pk, user_id uuid, board text,        -- e.g. 'daily:2026-12-01', 'league:2026-W49', 'ch:crosswind-01'
  score int, seconds int, preset text,              -- 'easy' | 'normal' | 'real'
  aircraft text, ghost bytea null,                  -- compressed, ≤ 32 KB, top runs only
  created_at timestamptz)
  -- RPC submit_skyward_run(): rate-limit, range-check, keep the best per (user, board)
  -- View: best per user per board; public read of name/avatar/score; ghost readable by anyone
```

The main all-time leaderboard on Senevon uses the existing `submit_score('skyward', score)`, with
the career score or the best landing score. This needs no new SQL.

## 4. Game-side module

`src/services/senevon.ts` is a TypeScript port of `integrations/droiddoom/senevon-account.js`,
adapted to:
- use the npm `@supabase/supabase-js` (not the CDN UMD);
- use `storageKey: "senevon-auth"` and `detectSessionInUrl: false`;
- expose `state` as a Preact signal; `buy(id, name)`; `open('plus' | 'tokens' | 'signin')`;
- refresh state when the tab becomes visible again (the player bought Plus elsewhere).

## 5. Guests

Guests (not signed in) can play Free Flight, Flight School and Career, with saves kept on the
device. Signing in later uploads the local save once (merge: higher rank and credits win). Daily
boards and leagues require sign-in. Guests can still play the daily but see a "Sign in to rank"
prompt.

## 6. Security notes

- Only the **public** anon key in the client. Never the service-role key.
- Credits earned in the game are client-reported, so they are soft currency only. Money and
  tokens move only through Senevon's server functions.
- Run submissions: server-side range checks, per-user rate limit, best-per-board. Ghosts let us
  check top runs for plausibility later.

## 7. Mayday scenarios (built; waiting for the store)

The game already asks `Entitlements.has("mayday_<id>")` (`src/services/entitlements.ts`). In
Phase 5 that class reads `skyward_state()` and buys with `skyward_buy()`. Until then locked
scenarios show their price and say purchases open with the Senevon connection; nothing is
charged. Development builds have a local "unlock all" switch for testing (absent from
production builds).

| Shop item (`shop_items.item_id`) | kind | Placeholder price (tokens) |
|---|---|---|
| — `engine_out` | free | 0 (no shop row needed) |
| `sw:mayday_rough_engine` | `sw_mayday` | 150 |
| `sw:mayday_fuel_leak` | `sw_mayday` | 150 |
| `sw:mayday_flap_jam` | `sw_mayday` | 100 |
| `sw:mayday_electrical` | `sw_mayday` | 200 |
| `sw:mayday_bird_strike` | `sw_mayday` | 200 |
| `sw:mayday_storm_approach` | `sw_mayday` | 250 |
| `sw:mayday_pack` (all six) | `sw_mayday` | 800 (suggested bundle) |

Senevon Plus / Pro / unlimited → all unlocked (same rule as DroidDoom).
