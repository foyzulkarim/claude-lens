/**
 * The one query language every chart speaks. See architecture.md §8 and
 * specs/architecture/ARCH-shared-contracts.md.
 */

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
  | "gatePassRate";

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

export type Grain = "hour" | "day" | "week" | "month";

export type DistributionEntity = "session" | "turn" | "call";

interface BaseMetricsQuery {
  measures: Measure[];
  dimensions: Dimension[];
  grain: Grain;
  range: { from: string; to: string };
  filters?: Partial<Record<Dimension, (string | number)[]>>;
  compare?: "previous-period";
  smoothing?: "none" | "ma7";
}

export type MetricsQuery =
  | (BaseMetricsQuery & { mode?: "series" })
  | (BaseMetricsQuery & { mode: "distribution"; distributionEntity: DistributionEntity });

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
