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
   * Stacks `"bars"`- and `"area"`-family series onto one shared stack
   * (ECharts `stack: "total"`) so the cumulative top edge reads as the
   * total — the Trends stacked-weekly-bars panel's project/model breakdown
   * (ARCH-trends-calendar-budget.md A4) and the Dashboard's four-measure
   * token composition (issue #122).
   *
   * Never applies to `"lines"`: a stacked plain line is visually
   * indistinguishable from absolute values, so it would misreport rather
   * than clarify. Where stacking *does* apply it also suppresses the
   * `compareGhost` overlay, whose absolute per-series values read at the
   * wrong magnitude over cumulative bands — the `"lines"` family keeps its
   * ghost, since nothing there is cumulative to read it against.
   *
   * Defaults to `false` so every existing unstacked call site is
   * unaffected.
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
 * (four measures, see `UNIT_MEASURES`) produces series that share the same
 * group label, so the legend/tooltip showed "All" four times with no way to
 * tell which band was which. Disambiguate by folding in the measure's human
 * name whenever more than one distinct measure is present in the same chart.
 *
 * Exported (issue #122) so `ChartCard`'s data table can key its columns by
 * the same identity the canvas uses — keying on `label` alone made the four
 * token series collapse into one last-write-wins column.
 */
export function seriesName(s: Series, distinctMeasureCount: number): string {
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
 *     overlay rides on this same shape; also honours `stacked` for the
 *     Dashboard's token composition)
 *   • `"lines"` — plain line without area fill (Explore page's Line chart
 *     selection; distinct from Area per the page's five-chart contract).
 *     Never stacks.
 */
export function buildTimeseriesOption(
  series: Series[],
  { family, unit, stacked = false }: BuildTimeseriesOptions,
): TimeseriesOption {
  const seriesOption: (LineSeriesOption | BarSeriesOption)[] = [];
  const distinctMeasureCount = new Set(series.map((s) => s.measure)).size;
  // Whether stacking is actually *applied*, not merely requested — `lines`
  // opts out entirely. Both the `stack` option and the ghost suppression key
  // off this, so a `lines` chart can never lose its ghost to a `stacked`
  // flag that had no other effect.
  const stacking = stacked && family !== "lines";

  for (const s of series) {
    const name = seriesName(s, distinctMeasureCount);

    if (family === "bars") {
      seriesOption.push({
        type: "bar",
        name,
        data: toData(s.points),
        ...(stacking ? { stack: "total" } : {}),
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
        ...(stacking ? { stack: "total" } : {}),
      });
    }

    if (s.compareGhost && !stacking) {
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
