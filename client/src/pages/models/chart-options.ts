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
 * ECharts option builders for the Models page (ARCH §A8 — Models — chart
 * families). The stacked-area "model mix over time" is the headline chart
 * ("did the new model change my spend profile?" — pages spec §6). One
 * input `Series[]` → one ECharts `series` per model, all stacked on the
 * shared `"model-mix"` stack so the chart visualises share as well as
 * trend.
 *
 * The "lines" family renders the same data unstacked so the user can
 * see rate-of-change per model without the area mask drowning the
 * smaller series.
 */

export type ModelsChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption | LegendComponentOption
>;

interface BuildStackedAreaOptions {
  unit: Unit;
  grain: Grain;
}

// Muted palette so even 6+ models stay distinguishable on the canvas.
// Cycles through the palette for series past `PALETTE.length`.
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

function safe(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return Number.isFinite(n) ? n : null;
}

function toStackedData(points: Series["points"]): [string, number | null][] {
  return points.map((point) => [point.t, safe(point.value)]);
}

/**
 * Stacked-area option for the model-mix-over-time panel. Each input
 * `Series` (one per model) becomes one stacked ECharts series labeled
 * with `series.label` so the legend mirrors the dimension axis. The
 * `"model-mix"` stack is the magic that turns the row of series into a
 * single "share of $ over time" visualization.
 */
export function buildModelMixAreaOption(
  series: Series[],
  { unit }: BuildStackedAreaOptions,
): ModelsChartOption {
  return {
    color: PALETTE,
    tooltip: {
      trigger: "axis",
      // Sum same-bucket values so the tooltip reports the bucket total
      // (matches Dashboard's "Cost over time" chart convention).
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
      stack: "model-mix",
      smooth: false,
      // Distinct per-series color so the legend swatches match the
      // rendered bands; the stack itself stays muted via area opacity.
      color: PALETTE[i % PALETTE.length],
      data: toStackedData(s.points),
      areaStyle: { opacity: 0.85 },
      lineStyle: { width: 1 },
      showSymbol: false,
      emphasis: { focus: "series" },
    })),
  };
}

/**
 * Lines (unstacked) variant of the model-mix chart — same data, just
 * without the shared stack. Useful when the user wants to see
 * rate-of-change per model without the area mask drowning the smaller
 * series (the mockup shows both shapes via its own swatch toggle).
 */
export function buildModelMixLinesOption(
  series: Series[],
  { unit }: BuildStackedAreaOptions,
): ModelsChartOption {
  return {
    color: PALETTE,
    tooltip: {
      trigger: "axis",
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
      smooth: false,
      color: PALETTE[i % PALETTE.length],
      data: toStackedData(s.points),
      lineStyle: { width: 2 },
      showSymbol: false,
    })),
  };
}

/** Summarizes one Series' bucket values for ARIA + range/trend summaries
 * used by the panel's wrapper. Mirrors `classifySpanSummary` from
 * `cache-lab/chart-options.ts` — kept independent so Models and Cache Lab
 * can evolve without coupling. */
export function summarizeSeries(seriesList: Series[]): {
  total: number;
  buckets: number;
} {
  let total = 0;
  let buckets = 0;
  for (const s of seriesList) {
    for (const p of s.points) {
      if (typeof p.value === "number" && Number.isFinite(p.value)) {
        total += p.value;
        buckets += 1;
      }
    }
  }
  return { total, buckets };
}
