/**
 * The one query language every chart speaks. See architecture.md §8 and
 * specs/architecture/ARCH-shared-contracts.md.
 */

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
};

export type MetricsQuery = SeriesMetricsQuery | DistributionMetricsQuery;

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
