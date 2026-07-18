import type {
  ScatterMeasure,
  ScatterMetricsQuery,
  ScatterMetricsResult,
  ScatterPoint,
  ScatterPopulationMeta,
  ScatterRegression,
} from "../../shared/metrics-contract.js";
import type { SessionPopulationFilter } from "../../shared/sessions-contract.js";
import type { MetricsInput } from "./engine.js";
import type { MeasureScope, PricingTable } from "./measures.js";
import {
  applyRange,
  indexSessionsByScope,
  measureForSession,
  totalTokensForSession,
  type SessionScope,
} from "./session-population.js";

/**
 * Session scatter (ARCH T3, A4 discriminated scatter). Pure: takes a
 * `MetricsInput` and a `ScatterMetricsQuery`, returns a `ScatterMetricsResult`
 * with full-population regression, eligibility accounting, and a
 * deterministic outlier-preserving visual-point sample (≤500).
 *
 * The scatter path is intentionally separate from `engine.ts`'s `metrics()`
 * to keep that function's `Series[]` return type stable for every existing
 * Dashboard caller (architecture §8 contract). `server/routes/metrics.ts`
 * dispatches on `mode === "scatter"` and calls `metricsScatter` here.
 */

// ---------------------------------------------------------------------------
// Constants & presets
// ---------------------------------------------------------------------------

/**
 * Visual-point cap for scatter (ARCH A5/R11). Exact regression and
 * eligibility accounting always run on the full population; only the
 * serialized `points` array is capped so the rendered ECharts canvas,
 * the semantic summary table, and the wire payload stay bounded.
 */
export const SCATTER_VISUAL_CAP = 500;

/** Outlier-preserving sample shape: the top/bottom `TAIL_SAMPLE` sorted
 * by Y plus evenly-spaced picks from the middle. With TAIL_SAMPLE=10 and
 * CAP=500 we keep 10 high + 10 low + 480 evenly-spaced middle picks. */
const TAIL_SAMPLE = 10;

// ---------------------------------------------------------------------------
// Preset mappings
// ---------------------------------------------------------------------------

/**
 * Per-session "tokens" measure for the "tokens × turns" preset (ARCH T3
 * presets). `totalTokens` isn't a `Measure` literal (the metrics contract
 * pins `MEASURES.length === 19`); the preset computes it here from
 * `Session.usage` so the page contract stays untouched.
 */
function presetTokensForSession(scope: SessionScope): number {
  return totalTokensForSession(scope.session);
}

/**
 * Resolve a `ScatterMeasure` into a numeric value for one session scope.
 * Pure — no Store, no Fastify, no I/O. Returns `null` for unavailable
 * measures (e.g. `costObserved` on a transcript-only session); the caller
 * is responsible for excluding/eligibility accounting.
 */
export function valueForSessionMeasure(
  measure: ScatterMeasure,
  scope: SessionScope,
  pricing: PricingTable,
): number | null {
  if (measure === "totalTokens") return presetTokensForSession(scope);
  return measureForSession(measure, scope, pricing);
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

/**
 * Compute a session scatter result. Combines the metrics query's
 * top-level `range` with its `sessionPopulation` criteria into a single
 * `SessionPopulationFilter`, applies it, indexes per-session scopes, and
 * produces points + regression + population metadata.
 */
export function metricsScatter(
  input: MetricsInput,
  query: ScatterMetricsQuery,
): ScatterMetricsResult {
  const filter: SessionPopulationFilter = {
    range: query.range,
    ...query.sessionPopulation,
  };
  const { matched, fromMs, toMs } = applyRange(filter, input.sessions);
  const scopes = indexSessionsByScope(matched, input.calls, input.turns);

  return buildScatterResult(scopes, input.pricing, query, {
    matched: matched.length,
    fromMs,
    toMs,
  });
}

/** Inputs handed to `buildScatterResult` to keep the pure helper
 * reusable in tests without re-running `applyRange`/`indexSessionsByScope`. */
interface ScatterBuildInputs {
  matched: number;
  fromMs: number;
  toMs: number;
}

function buildScatterResult(
  scopes: Map<string, SessionScope>,
  pricing: PricingTable,
  query: ScatterMetricsQuery,
  inputs: ScatterBuildInputs,
): ScatterMetricsResult {
  // Eligibility accounting: a session is eligible iff every requested
  // measure resolved to a finite number. Points with any null measure
  // are excluded from both the visible points and the regression, and
  // counted in `excludedMissingMeasures` so the UI can disclose the gap.
  const allPoints: ScatterPoint[] = [];
  let excludedMissingMeasures = 0;

  for (const scope of scopes.values()) {
    const x = valueForSessionMeasure(query.xMeasure, scope, pricing);
    const y = valueForSessionMeasure(query.yMeasure, scope, pricing);
    const size =
      query.sizeMeasure !== undefined
        ? valueForSessionMeasure(query.sizeMeasure, scope, pricing)
        : undefined;

    if (x === null || !Number.isFinite(x) || y === null || !Number.isFinite(y)) {
      if (x === null || y === null) excludedMissingMeasures++;
      continue;
    }

    const point: ScatterPoint = { sessionId: scope.session.sessionId, x, y };
    if (size !== undefined) point.size = size;
    allPoints.push(point);
  }

  // Regression runs on the FULL eligible population — sampling is a
  // post-regression projection so a 500-point sampled view still
  // represents the real underlying correlation.
  const regression = computeRegression(allPoints);

  const eligible = allPoints.length;
  const visual = samplePointsDeterministically(allPoints);

  const population: ScatterPopulationMeta = {
    matched: inputs.matched,
    eligible,
    returned: visual.length,
    excludedMissingMeasures,
    sampled: visual.length < eligible,
  };

  const result: ScatterMetricsResult = {
    mode: "scatter",
    entity: "session",
    xMeasure: query.xMeasure,
    yMeasure: query.yMeasure,
    sizeMeasure: query.sizeMeasure,
    points: visual,
    regression,
    population,
  };
  return result;
}

// ---------------------------------------------------------------------------
// OLS regression
// ---------------------------------------------------------------------------

/**
 * Ordinary-least-squares regression over the full eligible point set
 * (ARCH A4/R5). Returns `null` for degenerate populations: fewer than two
 * usable points, or all X values identical (variance = 0 → slope /
 * intercept would be NaN/Infinity otherwise). R² is the coefficient of
 * determination in [0, 1].
 */
export function computeRegression(points: ScatterPoint[]): ScatterRegression | null {
  const usable = points.filter(
    (p) =>
      typeof p.x === "number" &&
      Number.isFinite(p.x) &&
      typeof p.y === "number" &&
      Number.isFinite(p.y),
  );
  if (usable.length < 2) return null;

  const n = usable.length;
  let sumX = 0;
  let sumY = 0;
  for (const p of usable) {
    sumX += p.x as number;
    sumY += p.y as number;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of usable) {
    const dx = (p.x as number) - meanX;
    const dy = (p.y as number) - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const rSquared = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);

  return { slope, intercept, rSquared };
}

// ---------------------------------------------------------------------------
// Deterministic visual-point sampling
// ---------------------------------------------------------------------------

/**
 * Outlier-preserving deterministic visual sample (ARCH A5/R11).
 *
 * Strategy:
 *  1. Sort the eligible points by Y descending (stable tie-break on
 *     sessionId ascending so the picks are reproducible across requests).
 *  2. Take the top `TAIL_SAMPLE` (high outliers) and bottom `TAIL_SAMPLE`
 *     (low outliers).
 *  3. If eligible ≤ CAP, return all points (no sampling). Otherwise take
 *     every `floor(remaining / (CAP - 2*TAIL_SAMPLE))`th from the
 *     middle to fill to the cap. This produces a uniformly-spread
 *     subset that always includes both extremes — the documented
 *     "deterministic, outlier-preserving" behavior.
 *
 * The function is pure: same input → same output. No randomness, no
 * clock, no environment — so the wire payload is reproducible across
 * rerenders, refetches, and unit tests.
 */
export function samplePointsDeterministically(points: ScatterPoint[]): ScatterPoint[] {
  if (points.length <= SCATTER_VISUAL_CAP) return [...points];

  const sorted = [...points].sort((a, b) => {
    const yDiff = (b.y as number) - (a.y as number);
    if (yDiff !== 0) return yDiff;
    return a.sessionId.localeCompare(b.sessionId);
  });

  const head = sorted.slice(0, TAIL_SAMPLE);
  const tail = sorted.slice(-TAIL_SAMPLE);
  const middle = sorted.slice(TAIL_SAMPLE, sorted.length - TAIL_SAMPLE);

  const middleCap = SCATTER_VISUAL_CAP - head.length - tail.length;
  if (middleCap <= 0) {
    // Degenerate: eligible just barely above cap, no room for a middle.
    return [...head, ...tail];
  }
  const step = Math.max(1, Math.floor(middle.length / middleCap));
  const middleSample: ScatterPoint[] = [];
  for (let i = 0; i < middle.length && middleSample.length < middleCap; i += step) {
    const point = middle[i];
    if (point) middleSample.push(point);
  }
  return [...head, ...middleSample, ...tail];
}

// ---------------------------------------------------------------------------
// Pure helpers re-exported for unit tests
// ---------------------------------------------------------------------------

/**
 * Test-only re-export of the value lookup so callers don't need to know
 * the internal `valueForSessionMeasure` name. Same semantics.
 */
export const valueForSessionMeasureForTests = valueForSessionMeasure;

// Avoid unused-import warnings if `MeasureScope` is referenced only via
// re-export or future extension.
export type { MeasureScope };
