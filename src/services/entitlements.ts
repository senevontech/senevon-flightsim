/* What the player has unlocked. The game asks `has(id)` everywhere; it never decides on its own
   that something is owned.
   - Free items are always owned.
   - Until Skyward connects to the player's Senevon account (Phase 5: sign-in hand-off,
     skyward_state() / skyward_buy() — see docs/SENEVON_INTEGRATION.md), nothing can be bought:
     `storeAvailable` is false and the UI says so.
   - Development builds only (`npm run dev`) can unlock everything locally for testing. That switch
     doesn't exist in production builds. */

export interface PremiumItem {
  /** Senevon shop id without the "sw:" prefix, e.g. "mayday_rough_engine". */
  id: string;
  name: string;
  /** Price in Senevon tokens (placeholder; set in Senevon Admin → Tokens). */
  price: number;
}

const DEV = import.meta.env.DEV;
const KEY = "skyward.devUnlockAll";

export class Entitlements {
  private owned = new Set<string>();
  /** True once Senevon purchases are wired up (Phase 5). */
  readonly storeAvailable = false;

  constructor(free: string[]) {
    for (const id of free) this.owned.add(id);
  }

  get devBuild(): boolean {
    return DEV;
  }

  get devUnlockAll(): boolean {
    if (!DEV) return false;
    try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
  }

  set devUnlockAll(on: boolean) {
    if (!DEV) return;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* ignore */ }
  }

  has(id: string): boolean {
    return this.owned.has(id) || this.devUnlockAll;
  }
}
