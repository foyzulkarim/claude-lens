import type { ScorecardThresholds } from "../../shared/scorecard-contract.js";
import type { AppConfig } from "../../shared/settings-contract.js";

export const DEFAULT_SCORECARD_THRESHOLDS: ScorecardThresholds = {
  floorCalls: 10,
  calibrationMinSessions: 20,
  A: 95,
  B: 85,
  C: 70,
  D: 50,
};

function resolveCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function resolveBand(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100
    ? value
    : fallback;
}

export function getScorecardThresholds(config: AppConfig): ScorecardThresholds {
  const overrides = config.scorecardThresholds ?? {};
  const resolved: ScorecardThresholds = {
    floorCalls: resolveCount(overrides.floorCalls, DEFAULT_SCORECARD_THRESHOLDS.floorCalls),
    calibrationMinSessions: resolveCount(
      overrides.calibrationMinSessions,
      DEFAULT_SCORECARD_THRESHOLDS.calibrationMinSessions,
    ),
    A: resolveBand(overrides.A, DEFAULT_SCORECARD_THRESHOLDS.A),
    B: resolveBand(overrides.B, DEFAULT_SCORECARD_THRESHOLDS.B),
    C: resolveBand(overrides.C, DEFAULT_SCORECARD_THRESHOLDS.C),
    D: resolveBand(overrides.D, DEFAULT_SCORECARD_THRESHOLDS.D),
  };
  if (!(resolved.A > resolved.B && resolved.B > resolved.C && resolved.C > resolved.D)) {
    resolved.A = DEFAULT_SCORECARD_THRESHOLDS.A;
    resolved.B = DEFAULT_SCORECARD_THRESHOLDS.B;
    resolved.C = DEFAULT_SCORECARD_THRESHOLDS.C;
    resolved.D = DEFAULT_SCORECARD_THRESHOLDS.D;
  }
  return resolved;
}
