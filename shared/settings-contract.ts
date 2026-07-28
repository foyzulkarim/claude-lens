/**
 * Local config wire contract (ARCH-settings-local-store.md; architecture
 * §10). `~/.claude-lens/config.json` started narrow (#P4-10: `budget`,
 * `gateThresholds` only) and is extended here with `pricing`, `scanRoots`,
 * and `anomalyFactor` (#P4-15). `server/settings.ts` round-trips any key it
 * doesn't recognize unchanged so no future field is ever destroyed by an
 * older client.
 */

import type { GateThresholds } from "./gates-contract.js";
import { isValidPricingTable, type PricingTable } from "./pricing-contract.js";
import type { ScorecardThresholds } from "./scorecard-contract.js";

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
/** One scan root (architecture §5.1 discovery, §10 local config). `label` becomes the `host` dimension for every session sourced from `path`. */
export interface ScanRootConfig {
  path: string;
  label?: string;
}

export interface AppConfig {
  budget?: number | null;
  gateThresholds?: Partial<GateThresholds>;
  scorecardThresholds?: Partial<ScorecardThresholds>;
  /** Model -> rate table (#P4-15). Absent means the server's built-in `DEFAULT_PRICING_TABLE` applies. */
  pricing?: PricingTable;
  /** Scan roots + host labels (#P4-15). Absent means the CLI's `--roots` flag / default `~/.claude/projects` applies. Path changes need a restart; label changes are live. */
  scanRoots?: ScanRootConfig[];
  /** Anomaly detector multiplier (shared/anomaly.ts's `factor`). Absent means the detector's own default (5). Must be a finite number > 0. */
  anomalyFactor?: number;
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

/**
 * Mirrors `server/scorecard/thresholds.ts`'s `DEFAULT_SCORECARD_THRESHOLDS`
 * band values only (not the whole object — `shared/` must not import from
 * `server/`, matching the module-direction rule; the client keeps its own
 * separate display-only copy of the full default set for the same reason).
 * Needed so this validator can check a partial band patch against the
 * *effective* config it would produce once merged onto defaults, not just
 * the fields the caller happened to include (#124 review finding #4).
 */
const DEFAULT_SCORECARD_BANDS = { A: 95, B: 85, C: 70, D: 50 } as const;

export function isValidScorecardThresholds(value: unknown): value is Partial<ScorecardThresholds> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const knownFields = ["floorCalls", "calibrationMinSessions", "A", "B", "C", "D"] as const;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => (knownFields as readonly string[]).includes(key))) {
    return false;
  }
  for (const field of ["floorCalls", "calibrationMinSessions"] as const) {
    const fieldValue = record[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== "number" || !Number.isSafeInteger(fieldValue) || fieldValue < 0) {
      return false;
    }
  }
  for (const field of ["A", "B", "C", "D"] as const) {
    const fieldValue = record[field];
    if (fieldValue === undefined) continue;
    if (
      typeof fieldValue !== "number" ||
      !Number.isSafeInteger(fieldValue) ||
      fieldValue < 0 ||
      fieldValue > 100
    ) {
      return false;
    }
  }
  // Order-check the *effective* band set (patch fields merged onto the
  // defaults), not just whichever fields the caller included — a lone
  // `{ A: 40 }` passes a present-fields-only check (nothing else present to
  // compare against) but would resolve to an out-of-order {A:40, B:85(default),
  // C:70, D:50} once applied, which `getScorecardThresholds` can only react
  // to by silently reverting all four bands to defaults with no error.
  const bands = ["A", "B", "C", "D"] as const;
  const effective: Record<(typeof bands)[number], number> = { ...DEFAULT_SCORECARD_BANDS };
  for (const band of bands) {
    const fieldValue = record[band];
    if (typeof fieldValue === "number") effective[band] = fieldValue;
  }
  for (let leftIndex = 0; leftIndex < bands.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < bands.length; rightIndex += 1) {
      if (effective[bands[leftIndex]] <= effective[bands[rightIndex]]) return false;
    }
  }
  return true;
}

/** Re-exported so route/client code validating an `AppConfig.pricing` field doesn't need a second import. */
export { isValidPricingTable };

/**
 * Validates a `PUT /api/config` `scanRoots` field: an array of
 * `{path: string, label?: string}`. `path` must be a non-empty string;
 * `label`, when present, must be a non-empty string. No filesystem
 * existence check here — a not-yet-mounted volume (per the Settings
 * mockup) is a valid root, discovery's own glob just returns nothing for it.
 */
export function isValidScanRoots(value: unknown): value is ScanRootConfig[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key !== "path" && key !== "label") return false;
    }
    if (typeof record.path !== "string" || record.path.trim().length === 0) return false;
    if (record.label !== undefined) {
      if (typeof record.label !== "string" || record.label.trim().length === 0) return false;
    }
  }
  return true;
}

/** Anomaly detector multiplier: must be a finite number > 0 (matches `InvalidAnomalyFactorError`'s own guard in `shared/anomaly.ts`). */
export function isValidAnomalyFactor(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
