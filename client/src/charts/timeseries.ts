import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type { Series } from "../../../shared/metrics-contract.js";
import { formatUnitValue, MEASURE_LABELS, type Unit } from "./units.js";

export type TimeseriesOption = ComposeOption<
  LineSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

export interface BuildTimeseriesOptions {
  family: "area" | "bars" | "lines";
  unit: Unit;
  /**
   * Stacks `"bars"`-family series onto one shared stack (ECharts `stack:
   * "total"`) — the Trends stacked-weekly-bars panel's project/model
   * breakdown (ARCH-trends-calendar-budget.md A4). Ignored for the `"area"`
   * and `"lines"` families and for the `compareGhost` overlay, which never
   * stacks against the primary series. Defaults to `false` so every
   * existing bar-family call site (unstacked) is unaffected.
   */
  stacked?: boolean;
}

// Muted/dashed styling for the previous-period ghost line — visually
// distinct from the primary series without a second legend entry to manage.
const GHOST_LINE_STYLE = { type: "dashed" as const, opacity: 0.5 };

function toData(points: Series["points"]): [string, number | null][] {
  return points.map((point) => [point.t, point.value]);
}

/**
 * ECharts series name for one `Series`. `Series.label` is the *dimension
 * group's* label (e.g. "All" with no breakdown dimension, or a project/model
 * name) — it says nothing about which measure the series carries. That's
 * fine when a chart requests a single measure (the common case: every
 * group's label is already unique), but a multi-measure unit like `tokens`
 * (`inputTokens` + `outputTokens`, see `UNIT_MEASURES`) produces two series
 * that share the same group label, so the legend/tooltip showed "All"
 * twice with no way to tell which bar was which. Disambiguate by folding in
 * the measure's human name whenever more than one distinct measure is
 * present in the same chart.
 */
function seriesName(s: Series, distinctMeasureCount: number): string {
  if (distinctMeasureCount <= 1) return s.label;
  const measureLabel = MEASURE_LABELS[s.measure];
  return s.label === "All" ? measureLabel : `${s.label} · ${measureLabel}`;
}

/**
 * Pure `Series[]` → `EChartsOption` mapping for the timeseries chart family
 * (ARCH-chart-layer-live-chart.md T1). Never throws: an empty `series` input
 * still returns a valid, renderable option. Null points are passed through
 * as `null` (never coerced to 0), matching the engine's "never fabricate 0"
 * convention (server/metrics/measures.ts).
 *
 * Three rendering families:
 *   • `"bars"`  — bar series (with optional `stacked` for the Trends
 *     stacked-weekly breakdown)
 *   • `"area"`  — line with filled `areaStyle` (the previous-period ghost
 *     overlay rides on this same shape)
 *   • `"lines"` — plain line without area fill (Explore page's Line chart
 *     selection; distinct from Area per the page's five-chart contract)
 */
export function buildTimeseriesOption(
  series: Series[],
  { family, unit, stacked = false }: BuildTimeseriesOptions,
): TimeseriesOption {
  const seriesOption: (LineSeriesOption | BarSeriesOption)[] = [];
  const distinctMeasureCount = new Set(series.map((s) => s.measure)).size;

  for (const s of series) {
    const name = seriesName(s, distinctMeasureCount);

    if (family === "bars") {
      seriesOption.push({
        type: "bar",
        name,
        data: toData(s.points),
        ...(stacked ? { stack: "total" } : {}),
      });
    } else if (family === "lines") {
      seriesOption.push({
        type: "line",
        name,
        data: toData(s.points),
      });
    } else {
      seriesOption.push({
        type: "line",
        name,
        data: toData(s.points),
        areaStyle: {},
      });
    }

    if (s.compareGhost) {
      seriesOption.push({
        type: "line",
        name: `${name} (previous period)`,
        data: toData(s.compareGhost),
        lineStyle: GHOST_LINE_STYLE,
        itemStyle: { opacity: 0.5 },
        showSymbol: false,
      });
    }
  }

  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? formatUnitValue(value, unit) : String(value),
    },
    xAxis: { type: "time" },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number): string => formatUnitValue(value, unit) },
    },
    series: seriesOption,
  };
}
