/**
 * Local config wire contract (ARCH-trends-calendar-budget.md; architecture
 * §10). `~/.claude-lens/config.json` is deliberately typed narrow today —
 * only `budget` and `gateThresholds` are named fields. #P4-15 extends this
 * same file with pricing, scan roots, saved views, and tags; `server/settings.ts`
 * round-trips any key it doesn't recognize unchanged so this task can never
 * destroy a field it doesn't know about.
 */

import type { GateThresholds } from "./gates-contract.js";

/**
 * `budget` is `null`/absent when no monthly cap is set (the BurnRateCard's
 * existing "no budget set" state). A set value must be a finite number > 0
 * — enforced by `isValidBudget`, shared by the client form and the server
 * route so both sides agree on what "valid" means.
 *
 * `gateThresholds` is `Partial<GateThresholds>` — every field is optional,
 * missing fields default to the constants in `specs/gates.md` §"Configurable
 * constants". #P4-11 owns this field's shape; #P4-15 owns the Settings UI
 * form that edits it.
 */
export interface AppConfig {
  budget?: number | null;
  gateThresholds?: Partial<GateThresholds>;
}

/** `null` clears the budget; anything else must be a finite number > 0. */
export function isValidBudget(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Per-field validator for `AppConfig.gateThresholds`. Each present field
 * must be a finite, non-negative integer (thresholds are counts or token
 * totals — never floats). Missing fields are accepted; `getGateThresholds`
 * fills them from defaults. An unknown field is rejected so a typo
 * ("v2reapeat") surfaces as 400 from the route, not a silent default
 * fallback that hides the misconfiguration.
 */
export function isValidGateThresholds(value: unknown): value is Partial<GateThresholds> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const knownFields = ["v2Repeat", "c3MaxChars", "k2Spike", "e2MaxChars", "e2MaxLines"] as const;
  for (const key of Object.keys(record)) {
    if (!(knownFields as readonly string[]).includes(key)) return false;
  }
  for (const field of knownFields) {
    const v = record[field];
    if (v === undefined) continue;
    // Integer threshold: must be a non-negative safe integer. `Number.isSafeInteger`
    // already implies finite + integer (a safe integer is always both), and
    // the `< 0` check rejects negatives — the remaining failure modes are
    // only numbers > Number.MAX_SAFE_INTEGER, which are practically
    // unreachable from a JSON parse but explicit enough that the validator
    // also rejects the next hand-edited config.json with `2 ** 60`.
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
      return false;
    }
  }
  return true;
}
