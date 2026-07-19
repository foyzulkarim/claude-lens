/**
 * Local config wire contract (ARCH-trends-calendar-budget.md; architecture
 * §10). `~/.claude-lens/config.json` is deliberately typed narrow today —
 * only `budget` is a named field. #P4-15 extends this same file with
 * pricing, scan roots, thresholds, saved views, and tags; `server/settings.ts`
 * round-trips any key it doesn't recognize unchanged so this task can never
 * destroy a field it doesn't know about.
 */

/**
 * `budget` is `null`/absent when no monthly cap is set (the BurnRateCard's
 * existing "no budget set" state). A set value must be a finite number > 0
 * — enforced by `isValidBudget`, shared by the client form and the server
 * route so both sides agree on what "valid" means.
 */
export interface AppConfig {
  budget?: number | null;
}

/** `null` clears the budget; anything else must be a finite number > 0. */
export function isValidBudget(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
