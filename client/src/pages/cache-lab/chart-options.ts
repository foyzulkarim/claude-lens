import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type {
  BaselinePoint,
  ClassifiedCacheWrite,
  InvalidationCostPoint,
} from "../../../../shared/cache-lab-contract.js";
import { formatUnitValue } from "../../charts/units.js";

export type CacheLabChartOption = ComposeOption<
  LineSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

// Reject any NaN / Infinity before they reach ECharts (review finding N2).
// The analyzer is supposed to keep these out, but a buggy future migration
// or a fixture regression could let them through — better to drop than
// to render a broken canvas.
function safe(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return Number.isFinite(n) ? n : null;
}

/**
 * ECharts option for the cache-hit-rate trend. The Cache Lab hit-rate
 * panel takes one option, no per-bucket drill wiring (drill is owned
 * by HitRatePanel via the shared helper).
 */
export function buildHitRateOption(
  points: { t: string; hitRate: number | null }[],
): CacheLabChartOption {
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? `${(value * 100).toFixed(1)}%` : String(value),
    },
    xAxis: { type: "time" },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number): string => `${(value * 100).toFixed(0)}%`,
      },
      min: 0,
      max: 1,
    },
    series: [
      {
        type: "line",
        name: "Hit rate",
        data: points.map((p) => [p.t, safe(p.hitRate)]),
        areaStyle: {},
      },
    ],
  };
}

/**
 * Per-session cache-hit-rate histogram (one bar per session bucket).
 * Sessions with `null` (unpriced, so hit rate is undefined) are
 * represented as gaps rather than fabricated zeros.
 */
export function buildHitRateHistogramOption(
  bins: { rangeStart: number; rangeEnd: number; count: number }[],
): CacheLabChartOption {
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => (typeof value === "number" ? String(value) : String(value)),
    },
    xAxis: { type: "value", name: "Hit %" },
    yAxis: { type: "value", name: "Sessions" },
    series: [
      {
        type: "bar",
        name: "Sessions",
        data: bins.map((bin) => [bin.rangeStart, bin.count]),
      },
    ],
  };
}

/**
 * Median baseline-weight trend. Each bucket's median is plotted; null
 * medians (no sessions in that bucket) leave gaps so the chart never
 * lies about baseline drift on empty days.
 */
export function buildBaselineWeightOption(points: BaselinePoint[]): CacheLabChartOption {
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatUnitValue(value, "tokens") : String(value),
    },
    xAxis: { type: "time" },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number): string => formatUnitValue(value, "tokens"),
      },
    },
    series: [
      {
        type: "line",
        name: "Median baseline",
        data: points.map((p) => [p.t, safe(p.medianTokens)]),
      },
    ],
  };
}

/**
 * Stacked invalidation cost by cause over time. Each bucket's three
 * causes (model-switch / compaction / unexplained) stack into the
 * total bust-loss; null per-cause values are dropped (treated as no
 * contribution) so the chart still renders the priced causes cleanly.
 */
export function buildInvalidationCostOption(points: InvalidationCostPoint[]): CacheLabChartOption {
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatUnitValue(value, "$") : String(value),
    },
    legend: { data: ["Model switch", "Compaction", "Unexplained"] },
    xAxis: { type: "time" },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number): string => formatUnitValue(value, "$"),
      },
    },
    series: [
      {
        type: "bar",
        name: "Model switch",
        stack: "cost",
        data: points.map((p) => [p.t, safe(p.modelSwitch)]),
      },
      {
        type: "bar",
        name: "Compaction",
        stack: "cost",
        data: points.map((p) => [p.t, safe(p.compaction)]),
      },
      {
        type: "bar",
        name: "Unexplained",
        stack: "cost",
        data: points.map((p) => [p.t, safe(p.unexplained)]),
      },
    ],
  };
}

/**
 * Total invalidation cost by cause — the "which K2 cause costs the
 * most over the period" summary. Reads the trend points and collapses
 * to one bar per cause; null per-bucket values are ignored.
 */
export function buildInvalidationCostTotalsOption(
  points: InvalidationCostPoint[],
): CacheLabChartOption {
  const sum = (key: "modelSwitch" | "compaction" | "unexplained"): number =>
    points.reduce((total, p) => {
      const v = p[key];
      return total + (typeof v === "number" && Number.isFinite(v) ? v : 0);
    }, 0);
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatUnitValue(value, "$") : String(value),
    },
    xAxis: { type: "category", data: ["Model switch", "Compaction", "Unexplained"] },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number): string => formatUnitValue(value, "$"),
      },
    },
    series: [
      {
        type: "bar",
        name: "Total cost",
        data: [sum("modelSwitch"), sum("compaction"), sum("unexplained")],
      },
    ],
  };
}

/**
 * Estimated context-growth curves (token-estimated). Each curve is its
 * own series so the legend stays stable across the page.
 */
export function buildContextGrowthOption(
  curves: { sessionId: string; points: { turnIndex: number; inputTokens: number }[] }[],
): CacheLabChartOption {
  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatUnitValue(value, "tokens") : String(value),
    },
    legend: { type: "scroll", data: curves.map((c) => c.sessionId) },
    xAxis: { type: "category", name: "Turn index" },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number): string => formatUnitValue(value, "tokens"),
      },
    },
    series: curves.map((curve) => ({
      type: "line" as const,
      name: curve.sessionId,
      data: curve.points.map((p) => [p.turnIndex, safe(p.inputTokens)]),
      showSymbol: false,
    })),
  };
}

/**
 * Summary builder used by panel aria-labels. Counts finite, non-null
 * values only so a single poisoned bucket can't make the panel say
 * "no data" while it has plenty of priced history.
 */
export function classifySpanSummary(points: { t: string; value: number | null }[]): {
  total: number;
  finiteBuckets: number;
  firstT: string | null;
  lastT: string | null;
} {
  let total = 0;
  let finiteBuckets = 0;
  let firstT: string | null = null;
  let lastT: string | null = null;
  for (const point of points) {
    if (firstT === null) firstT = point.t;
    lastT = point.t;
    if (typeof point.value === "number" && Number.isFinite(point.value)) {
      total += point.value;
      finiteBuckets++;
    }
  }
  return { total, finiteBuckets, firstT, lastT };
}

/**
 * Defensive helper used by panels to confirm a `ClassifiedCacheWrite[]`
 * is the page's actual response shape (not a payload from an older
 * server). Cheap O(n) check; panel tests use it to pin "T2 contract
 * honored" without spinning up the analyzer.
 */
export function eventCount(events: ClassifiedCacheWrite[] | undefined): number {
  return events?.length ?? 0;
}
