import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type { Series } from "../../../shared/metrics-contract.js";
import { formatUnitValue, type Unit } from "./units.js";

export type TimeseriesOption = ComposeOption<
  LineSeriesOption | BarSeriesOption | GridComponentOption | TooltipComponentOption
>;

export interface BuildTimeseriesOptions {
  family: "area" | "bars";
  unit: Unit;
}

// Muted/dashed styling for the previous-period ghost line — visually
// distinct from the primary series without a second legend entry to manage.
const GHOST_LINE_STYLE = { type: "dashed" as const, opacity: 0.5 };

function toData(points: Series["points"]): [string, number | null][] {
  return points.map((point) => [point.t, point.value]);
}

/**
 * Pure `Series[]` → `EChartsOption` mapping for the timeseries chart family
 * (ARCH-chart-layer-live-chart.md T1). Never throws: an empty `series` input
 * still returns a valid, renderable option. Null points are passed through
 * as `null` (never coerced to 0), matching the engine's "never fabricate 0"
 * convention (server/metrics/measures.ts).
 */
export function buildTimeseriesOption(
  series: Series[],
  { family, unit }: BuildTimeseriesOptions,
): TimeseriesOption {
  const seriesOption: (LineSeriesOption | BarSeriesOption)[] = [];

  for (const s of series) {
    if (family === "bars") {
      seriesOption.push({
        type: "bar",
        name: s.label,
        data: toData(s.points),
      });
    } else {
      seriesOption.push({
        type: "line",
        name: s.label,
        data: toData(s.points),
        areaStyle: {},
      });
    }

    if (s.compareGhost) {
      seriesOption.push({
        type: "line",
        name: `${s.label} (previous period)`,
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
