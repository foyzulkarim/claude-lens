/**
 * The one query language every chart speaks. See architecture.md §8 and
 * specs/architecture/ARCH-shared-contracts.md.
 */

import type { SessionPopulationCriteria } from "./sessions-contract.js";

// Forces every literal of T into the returned array — the `[T] extends
// [U[number]] ? unknown : never` trick (wrapped in tuples to block union
// distribution) fails to compile if `array` omits a union member, so
// MEASURES/DIMENSIONS/GRAINS below can't silently drift out of sync with
// their union types the way a hand-copied Set literal could.
function exhaustiveArray<T extends string>() {
  return <U extends readonly T[]>(array: U & ([T] extends [U[number]] ? unknown : never)): U =>
    array;
}

export type Measure =
  | "costComputed"
  | "costObserved"
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheCreateTokens"
  | "apiCalls"
  | "turns"
  | "sessions"
  | "toolCalls"
  | "cacheHitPct"
  | "wallMinutes"
  | "apiMs"
  | "linesAdded"
  | "linesRemoved"
  | "gatePassRate"
  | "toolErrors"
  | "cacheSavingsComputed"
  | "routingSavingsComputed";

export const MEASURES = exhaustiveArray<Measure>()([
  "costComputed",
  "costObserved",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreateTokens",
  "apiCalls",
  "turns",
  "sessions",
  "toolCalls",
  "cacheHitPct",
  "wallMinutes",
  "apiMs",
  "linesAdded",
  "linesRemoved",
  "gatePassRate",
  "toolErrors",
  "cacheSavingsComputed",
  "routingSavingsComputed",
]);

export type Dimension =
  | "time"
  | "project"
  | "model"
  | "gitBranch"
  | "version"
  | "entrypoint"
  | "sidechain"
  | "tool"
  | "gateStatus"
  | "host";

export const DIMENSIONS = exhaustiveArray<Dimension>()([
  "time",
  "project",
  "model",
  "gitBranch",
  "version",
  "entrypoint",
  "sidechain",
  "tool",
  "gateStatus",
  "host",
]);

export type Grain = "hour" | "day" | "week" | "month";

export const GRAINS = exhaustiveArray<Grain>()(["hour", "day", "week", "month"]);

export type DistributionEntity = "session" | "turn" | "call";

interface BaseMetricsQuery {
  measures: Measure[];
  dimensions: Dimension[];
  grain: Grain;
  range: { from: string; to: string };
  filters?: Partial<Record<Dimension, (string | number)[]>>;
}

// compare/smoothing only apply to mode: "series" — a distribution-mode query
// never reaches the post-processing steps that read them (engine.ts's
// `metrics()` returns from the distribution branch first), so they're kept
// off that variant's type rather than accepted-but-silently-ignored.
export type SeriesMetricsQuery = BaseMetricsQuery & {
  mode?: "series";
  compare?: "previous-period";
  smoothing?: "none" | "ma7";
};

export type DistributionMetricsQuery = BaseMetricsQuery & {
  mode: "distribution";
  distributionEntity: DistributionEntity;
  /**
   * Optional session-population narrowing for distribution queries (ARCH
   * A2 / Sessions page). When present, the distribution computes over
   * the session-scoped population criteria instead of the global
   * metric-filter shape. Currently used by the Sessions page's cost
   * histogram / percentiles — and by any future session-level
   * distribution.
   *
   * The shape mirrors `ScatterMetricsQuery.sessionPopulation` exactly so
   * the two can share one helper (`buildSessionPopulation` in
   * `client/src/pages/sessions/state.ts`) and so a future server route
   * change can validate one schema for both call sites.
   */
  sessionPopulation?: SessionPopulationCriteria;
};

/**
 * The scatter-only `"totalTokens"` literal (sum of the four token
 * categories per session). It is NOT a `Measure` (the metrics contract
 * pins `MEASURES.length === 19`), but it is a valid scatter axis so the
 * "tokens × turns" preset can request it without widening the metrics
 * contract's MEASURES union (ARCH A11).
 */
export type ScatterMeasure = Measure | "totalTokens";

/**
 * Per-session scatter query (ARCH `ScatterMetricsQuery`). Returns a
 * `ScatterMetricsResult` rather than `Series[]` — the engine's existing
 * return type stays `Series[]`, so this is dispatched through a sibling
 * helper (`metricsScatter`) instead of widening `metrics()`.
 *
 * `xMeasure`/`yMeasure` accept the `ScatterMeasure` union (existing
 * `Measure` plus the scatter-only `totalTokens` preset). Aggregation
 * measures (`apiCalls`, `sessions`, etc.) are valid on a scatter axis
 * even though they make less intuitive sense — the contract doesn't
 * second-guess user choice.
 *
 * `measures` is widened to `ScatterMeasure[]` via `Omit` so the inherited
 * `Measure[]` strictness doesn't reject a scatter query that requests the
 * preset `totalTokens` axis. The base shape's required `measures: []`
 * invariant is preserved by always populating it with the requested axes.
 *
 * `sessionPopulation` is the metrics-query shape (`Omit<…, "range">`); the
 * query's own top-level `range` and the population's `from`/`to` are
 * reconciled by the engine — see `server/metrics/session-population.ts`.
 */
export type ScatterMetricsQuery = Omit<BaseMetricsQuery, "measures"> & {
  mode: "scatter";
  entity: "session";
  measures: ScatterMeasure[];
  xMeasure: ScatterMeasure;
  yMeasure: ScatterMeasure;
  sizeMeasure?: ScatterMeasure;
  sessionPopulation: SessionPopulationCriteria;
};

export type MetricsQuery = SeriesMetricsQuery | DistributionMetricsQuery | ScatterMetricsQuery;

export interface SeriesPoint {
  t: string;
  value: number | null;
}

export interface Distribution {
  p50: number | null;
  p90: number | null;
  p99: number | null;
  histogram: { rangeStart: number; rangeEnd: number; count: number }[];
  pareto?: {
    curve: { entityPct: number; cumulativeValuePct: number }[];
    topDecileValuePct: number;
  };
}

export interface Series {
  measure: Measure;
  dimensionKey: string;
  label: string;
  points: SeriesPoint[];
  basis?: "computed" | "observed";
  compareGhost?: SeriesPoint[];
  distribution?: Distribution;
}

/**
 * One scatter point (ARCH `ScatterPoint`). `sessionId` is the row identity
 * (so the UI can drill into a single point), `x`/`y` are the requested
 * measure values, and `size` is the optional third-measure value. Any
 * field can be `null` when the measure is unavailable on that session
 * (e.g. `costObserved` on a transcript-only session) — the scatter
 * contract deliberately excludes those from `points` rather than
 * fabricating a 0 (ARCH A11).
 */
export interface ScatterPoint {
  sessionId: string;
  x: number | null;
  y: number | null;
  size?: number | null;
}

/**
 * Ordinary least squares regression. `null` when fewer than two usable
 * points are present or all X values are identical — the degenerate case
 * would otherwise produce NaN/Infinity slope/intercept (ARCH degenerate-
 * population scenario).
 */
export interface ScatterRegression {
  slope: number;
  intercept: number;
  rSquared: number;
}

/**
 * Population metadata for a scatter result. Mirrors the
 * `SessionTimelineSet` accounting — full population is `matched`,
 * `eligible` excludes sessions where one of the requested measures is
 * unavailable, and `returned` is the visible-point count after sampling.
 */
export interface ScatterPopulationMeta {
  matched: number;
  eligible: number;
  returned: number;
  excludedMissingMeasures: number;
  sampled: boolean;
}

/**
 * Session scatter response (ARCH `ScatterMetricsResult`). The discriminator
 * (`mode: "scatter"`) lets `client/src/api/metrics.ts` write a separate,
 * narrower wrapper (`postScatterMetrics`) without widening the existing
 * `postMetrics` aggregate response type.
 */
export interface ScatterMetricsResult {
  mode: "scatter";
  entity: "session";
  xMeasure: ScatterMeasure;
  yMeasure: ScatterMeasure;
  sizeMeasure?: ScatterMeasure;
  points: ScatterPoint[];
  /** `null` for degenerate populations (<2 usable points or identical X). */
  regression: ScatterRegression | null;
  population: ScatterPopulationMeta;
}
