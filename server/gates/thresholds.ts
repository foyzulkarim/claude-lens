import { K2_SPIKE_THRESHOLD } from "../cache/classifier.js";
import type { AppConfig } from "../../shared/settings-contract.js";
import type { GateThresholds } from "../../shared/gates-contract.js";

/**
 * Default gate thresholds — every value matches `specs/gates.md`
 * §"Configurable constants". V1, P3, and E1 are threshold-free by design
 * (gates.md preamble), so they don't appear here; the engine treats missing
 * thresholds for them as N/A, never as a number.
 *
 * `k2Spike` mirrors `K2_SPIKE_THRESHOLD` in `server/cache/classifier.ts` —
 * the runtime equality assertion at the bottom of this file fails the
 * test suite if a future revision changes one without the other (review
 * nice-to-have "equality assertion"). They're the same logical threshold
 * expressed in two places because the classifier is a shared primitive
 * (#P4-9 + #P4-11) and this is the user-facing default; the engine
 * always passes the resolved value through.
 */
export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  v2Repeat: 3,
  c3MaxChars: 15_000,
  k2Spike: K2_SPIKE_THRESHOLD,
  e2MaxChars: 4_000,
  e2MaxLines: 60,
};

/**
 * Coerce an override value to a non-negative integer threshold.
 *
 * `isValidGateThresholds` already rejects malformed values on the
 * `PUT /api/config` path, but a hand-edited `~/.claude-lens/config.json`
 * (or a future client) can land values that bypassed validation —
 * negative numbers, non-integers, NaN, Infinity. Without clamping, a
 * hand-edited `v2Repeat: -1` would fire V2 on every failure (the
 * comparison `slot.count < -1` is always false). The engine must
 * never see a malformed threshold (review M1).
 */
function clampThreshold(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  // Counts and token totals are integers by contract — `Math.floor`
  // rounds down rather than throwing on a stray `.5`.
  return Math.floor(value);
}

/**
 * Resolve a complete `GateThresholds` from an `AppConfig`. Missing or
 * malformed fields fall back to `DEFAULT_GATE_THRESHOLDS`. Never throws —
 * even a hand-edited config with negative or non-integer values is
 * reduced to the valid subset here.
 */
export function getGateThresholds(config: AppConfig): GateThresholds {
  const overrides = config.gateThresholds ?? {};
  return {
    v2Repeat: clampThreshold(overrides.v2Repeat, DEFAULT_GATE_THRESHOLDS.v2Repeat),
    c3MaxChars: clampThreshold(overrides.c3MaxChars, DEFAULT_GATE_THRESHOLDS.c3MaxChars),
    k2Spike: clampThreshold(overrides.k2Spike, DEFAULT_GATE_THRESHOLDS.k2Spike),
    e2MaxChars: clampThreshold(overrides.e2MaxChars, DEFAULT_GATE_THRESHOLDS.e2MaxChars),
    e2MaxLines: clampThreshold(overrides.e2MaxLines, DEFAULT_GATE_THRESHOLDS.e2MaxLines),
  };
}

/**
 * Equality guard: `k2Spike` in the user-facing defaults must match
 * `K2_SPIKE_THRESHOLD` in the cache classifier, since the classifier's
 * default is the source of truth for Cache Lab and the gates default
 * mirrors it. If a future revision changes one without the other, this
 * module-level constant evaluation makes the divergence a hard runtime
 * error on first import — caught by `npm run verify`, not by a confused
 * user two weeks later.
 */
const _K2_SPIKE_DEFAULTS_MUST_MATCH: boolean =
  DEFAULT_GATE_THRESHOLDS.k2Spike === K2_SPIKE_THRESHOLD;
if (!_K2_SPIKE_DEFAULTS_MUST_MATCH) {
  throw new Error(
    `DEFAULT_GATE_THRESHOLDS.k2Spike (${DEFAULT_GATE_THRESHOLDS.k2Spike}) must equal ` +
      `K2_SPIKE_THRESHOLD from server/cache/classifier.ts (${K2_SPIKE_THRESHOLD})`,
  );
}
