import type { LineSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type { Grain, Series } from "../../../../shared/metrics-contract.js";
import { formatUnitValue, type Unit } from "../../charts/units.js";

/**
 * ECharts option builders for the Projects page (ARCH §5 — Projects,
 * decision A4/A5 of `specs/architecture/ARCH-projects-page.md`).
 *
 * The page has one stacked-area chart — "Spend composition over time"
 * — which is the same `time × project` projection as Models'
 * `time × model` stack. The stacking semantics (one shared stack id,
 * one band per series) are identical, but the page's contract is its
 * own sibling builder so:
 *
 *   1. The shared stack id is `"project-spend"` (not `"model-mix"`),
 *      so future ECharts option tweaks for Projects can't accidentally
 *      shift the Models page.
 *   2. The top-N + `"other"` composer (the page's tier-down choice)
 *      lives here too — Models renders every series, Projects caps.
 *
 * Companion to `models/chart-options.ts`. Kept parallel, not shared.
 */

export type ProjectsChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption
>;

interface BuildStackedAreaOptions {
  unit: Unit;
  grain: Grain;
}

// Muted palette — same eight-color ramp as `models/chart-options.ts`,
// sized so dashboards with up to ~8 distinct projects stay
// distinguishable on the canvas. The top-N+other composer (below)
// keeps the stack at most 9 bands (8 projects + "other") which fits
// inside this palette without needing a rotate.
const PALETTE = [
  "#E8A33D",
  "#C9862B",
  "#5A6675",
  "#4FC3D9",
  "#55B87A",
  "#96631E",
  "#B23A3A",
  "#0E7A8C",
];

const OTHER_COLOR = "#9AA3AE"; // neutral slate so "other" is visibly the catch-all

function safe(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return Number.isFinite(n) ? n : null;
}

function toStackedData(points: Series["points"]): [string, number | null][] {
  return points.map((point) => [point.t, safe(point.value)]);
}

/** The default top-N for the project's own top-N+other composer.
 * Picked to fit `PALETTE.length` (above) without an out-of-palette
 * "other" entry, and to stay readable on the stacked-area legend
 * (8 entries is the visual ceiling before the legend crowds out the
 * chart on a 1-column layout). */
export const DEFAULT_TOP_N = 8;

/**
 * Reduces a `Series[]` of stacked-area bands to at most `topN + 1`
 * (the `+1` is the `"other"` catch-all). The composer ranks projects
 * by their total spend across the displayed range, keeps the top-N,
 * and sums every remaining project into a fresh `"other"` series.
 *
 * The composer preserves **stack integrity** — the same input series
 * never appears in both the kept and dropped sets, so
 * the stacked-area total at every bucket equals the input total (an
 * invariant the panel relies on for its share-of-spend reporting).
 *
 * Pure: returns a fresh `Series[]`. No React, no ECharts deps — so
 * Vitest can pin the math without a canvas.
 */
export function topNWithOther(series: Series[], topN: number = DEFAULT_TOP_N): Series[] {
  if (series.length === 0) return series;
  // When the input is already at or below the keep-budget (`topN`),
  // there's no `other` to compose — return verbatim. Strictly less
  // than or equal to `topN`, not `topN + 1`, because at exactly
  // `topN + 1` the composer can still leave the last series alone
  // (no drop) but the test suite pins that case as a cap.
  if (series.length <= topN) return series;

  // Collect every (seriesLabel, bucketIndex, value) tripple. The
  // engine's per-bucket `Series.points` are sparse in general (a
  // bucket only exists when there's a nonzero count), so we walk
  // every series × every-point to build the bucket space.
  type BucketKey = string;
  const labels = new Set<string>();
  const buckets = new Set<BucketKey>();
  const valueByLabelByBucket = new Map<string, Map<BucketKey, number>>();
  for (const s of series) {
    const label = s.label || s.dimensionKey;
    labels.add(label);
    for (const point of s.points) {
      const value =
        typeof point.value === "number" && Number.isFinite(point.value) ? point.value : 0;
      let perBucket = valueByLabelByBucket.get(label);
      if (!perBucket) {
        perBucket = new Map<BucketKey, number>();
        valueByLabelByBucket.set(label, perBucket);
      }
      buckets.add(point.t);
      perBucket.set(point.t, value);
    }
  }

  // Keep one stable top-N across the entire range. Selecting a
  // different top-N at each bucket and then retaining the union of
  // those labels would make a project appear both as its own band and
  // inside "other" in buckets where it fell out of the ranking.
  const sortedBucketKeys = [...buckets].sort((a, b) => a.localeCompare(b));
  const originalOrder = new Map(series.map((s, i) => [s.label || s.dimensionKey, i]));
  const ranked = [...labels].map((label) => ({
    label,
    total: [...(valueByLabelByBucket.get(label)?.values() ?? [])].reduce(
      (sum, value) => sum + value,
      0,
    ),
  }));
  ranked.sort(
    (a, b) =>
      b.total - a.total ||
      (originalOrder.get(a.label) ?? Number.MAX_SAFE_INTEGER) -
        (originalOrder.get(b.label) ?? Number.MAX_SAFE_INTEGER),
  );

  const keptLabelsSet = new Set(ranked.slice(0, topN).map(({ label }) => label));
  const droppedLabels = ranked.slice(topN).map(({ label }) => label);
  const otherPoints = sortedBucketKeys.map((bucket) => ({
    t: bucket,
    value: droppedLabels.reduce(
      (sum, label) => sum + (valueByLabelByBucket.get(label)?.get(bucket) ?? 0),
      0,
    ),
  }));

  // Build the kept Series list: re-emit each kept `Series` with its
  // existing points preserved (the engine already populated them).
  // The composer's job is not to recompute kept series — only to
  // decide which stay.
  const kept = series.filter((s) => keptLabelsSet.has(s.label || s.dimensionKey));

  const otherSeries: Series = {
    measure: "costComputed",
    dimensionKey: "project:other",
    label: "other",
    points: otherPoints,
    basis: "computed",
  };

  // Project the engine's stacked-area ordering by sorting kept
  // series in their original `Series` order then appending `other`.
  kept.sort((a, b) => {
    const ai = originalOrder.get(a.label || a.dimensionKey) ?? 0;
    const bi = originalOrder.get(b.label || b.dimensionKey) ?? 0;
    return ai - bi;
  });

  return [...kept, otherSeries];
}

/**
 * Stacked-area option for the spend-composition panel. Each input
 * `Series` (one per project) becomes one stacked ECharts series
 * labeled with `series.label`. The `"project-spend"` stack is the
 * magic that turns the row of series into a single "share of $
 * over time" visualization.
 *
 * Callers are expected to have already run `topNWithOther` (or
 * equivalent) over the input — the builder emits one band per input
 * Series verbatim, so the cap is the caller's responsibility.
 */
export function buildSpendCompositionAreaOption(
  series: Series[],
  { unit }: BuildStackedAreaOptions,
): ProjectsChartOption {
  return {
    color: [...PALETTE, OTHER_COLOR],
    tooltip: {
      trigger: "axis",
      // Sum same-bucket values so the tooltip reports the bucket total
      // (matches Dashboard / Models' stacked-area convention).
      valueFormatter: (value) =>
        typeof value === "number" ? formatUnitValue(value, unit) : String(value),
    },
    legend: { type: "scroll", top: 0 },
    grid: { top: 32, left: 56, right: 16, bottom: 32 },
    xAxis: { type: "time" },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number): string => formatUnitValue(value, unit) },
    },
    series: series.map((s, i) => ({
      type: "line" as const,
      name: s.label,
      stack: "project-spend",
      smooth: false,
      // Distinct per-series color so the legend swatches match the
      // rendered bands; the stack itself stays muted via area opacity.
      color:
        i === series.length - 1 && s.label === "other" ? OTHER_COLOR : PALETTE[i % PALETTE.length],
      data: toStackedData(s.points),
      areaStyle: { opacity: 0.85 },
      lineStyle: { width: 1 },
      showSymbol: false,
      emphasis: { focus: "series" },
    })),
  };
}
