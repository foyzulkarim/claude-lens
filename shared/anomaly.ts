/**
 * User-history-aware anomaly detector for turn cost samples.
 *
 * Returns a deterministic baseline (median), threshold ratio, and flagged
 * samples. The detector receives pre-priced inputs — it does not compute
 * pricing itself. It is the single source of truth for "expensive turn"
 * judgments used by the Dashboard anomaly feed (T13) and Session Detail's
 * per-turn bars.
 */

import type { TurnCostSample } from "./types.js";

export type { TurnCostSample } from "./types.js";

/**
 * Anomaly detection result.
 *
 * - `baseline`: median cost of all samples (null when population < 2)
 * - `ratio`: threshold used = baseline * factor (null when population < 2)
 * - `flagged`: samples whose cost exceeds the threshold
 */
export interface TurnAnomalyResult {
  baseline: number | null;
  ratio: number | null;
  flagged: TurnCostSample[];
}

/**
 * Error thrown when the anomaly factor is not a positive number.
 */
export class InvalidAnomalyFactorError extends TypeError {
  readonly factor: unknown;
  constructor(factor: unknown) {
    super(`Anomaly factor must be a positive number, got ${JSON.stringify(factor)}.`);
    this.factor = factor;
    this.name = "InvalidAnomalyFactorError";
  }
}

/** Default anomaly factor: a turn must exceed 5× the median to be flagged. */
const DEFAULT_FACTOR = 5;

function computeMedian(sorted: readonly number[]): number {
  const len = sorted.length;
  if (len === 0) return NaN;
  const mid = Math.floor(len / 2);
  return len % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Detect turns whose cost is anomalously high relative to the population.
 *
 * ### Behaviour
 *
 * - Throws {@link InvalidAnomalyFactorError} when `factor <= 0` or not a number.
 * - Returns `{baseline: null, ratio: null, flagged: []}` when fewer than two
 *   samples are supplied (insufficient population for a meaningful median).
 * - Returns `{baseline: null, ratio: null, flagged: []}` for an empty array.
 * - Flags are ordered by descending cost to match typical "worst offenders"
 *   presentation.
 *
 * ### Purity guarantee
 *
 * The input `samples` array and its elements are never mutated.
 *
 * ### Determinism
 *
 * Results are stable for stable inputs: the sort is deterministic (JS sort is
 * specification-stable since ES2019), and no external state is consulted.
 */
export function detectTurnCostAnomalies(
  samples: TurnCostSample[],
  factor: number = DEFAULT_FACTOR,
): TurnAnomalyResult {
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0) {
    throw new InvalidAnomalyFactorError(factor);
  }

  if (samples.length < 2) {
    return { baseline: null, ratio: null, flagged: [] };
  }

  // Clone so we never mutate the caller's array.
  const sortedCosts = [...samples].map((s) => s.costComputed).sort((a, b) => a - b);

  const baseline = computeMedian(sortedCosts);
  const threshold = baseline * factor;

  const flagged = samples
    .filter((s) => s.costComputed > threshold)
    // Stable-descending order for consistent output.
    .sort((a, b) => b.costComputed - a.costComputed);

  return { baseline, ratio: threshold, flagged };
}
