import type { AppConfig } from "../../shared/settings-contract.js";
import type { GateThresholds } from "../../shared/gates-contract.js";

/**
 * Default gate thresholds — every value matches `specs/gates.md`
 * §"Configurable constants". V1, P3, and E1 are threshold-free by design
 * (gates.md preamble), so they don't appear here; the engine treats missing
 * thresholds for them as N/A, never as a number.
 *
 * `k2Spike` mirrors `K2_SPIKE_THRESHOLD` in `server/cache/classifier.ts` —
 * if a future revision changes the classifier's default, this value must
 * change to match. They're the same logical threshold expressed in two
 * places because the classifier is a shared primitive (#P4-9 + #P4-11) and
 * this is the user-facing default; the engine always passes the resolved
 * value through.
 */
export const DEFAULT_GATE_THRESHOLDS: GateThresholds = {
  v2Repeat: 3,
  c3MaxChars: 15_000,
  k2Spike: 10_000,
  e2MaxChars: 4_000,
  e2MaxLines: 60,
};

/**
 * Resolve a complete `GateThresholds` from an `AppConfig`. Missing fields
 * fall back to `DEFAULT_GATE_THRESHOLDS`. Never throws — even a malformed
 * `gateThresholds` block (e.g. an extra unknown field) is reduced to its
 * valid subset via `isValidGateThresholds` upstream, and absent/invalid
 * fields default here.
 */
export function getGateThresholds(config: AppConfig): GateThresholds {
  const overrides = config.gateThresholds ?? {};
  return {
    v2Repeat: overrides.v2Repeat ?? DEFAULT_GATE_THRESHOLDS.v2Repeat,
    c3MaxChars: overrides.c3MaxChars ?? DEFAULT_GATE_THRESHOLDS.c3MaxChars,
    k2Spike: overrides.k2Spike ?? DEFAULT_GATE_THRESHOLDS.k2Spike,
    e2MaxChars: overrides.e2MaxChars ?? DEFAULT_GATE_THRESHOLDS.e2MaxChars,
    e2MaxLines: overrides.e2MaxLines ?? DEFAULT_GATE_THRESHOLDS.e2MaxLines,
  };
}
