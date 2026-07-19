import type { HeatmapSeriesOption } from "echarts/charts";
import type {
  CalendarComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type { Series } from "../../../shared/metrics-contract.js";
import { pointValue } from "./series-math.js";
import type { Unit } from "./units.js";

export type CalendarHeatmapOption = ComposeOption<
  HeatmapSeriesOption | CalendarComponentOption | VisualMapComponentOption | TooltipComponentOption
>;

export interface BuildCalendarHeatmapOptions {
  unit: Unit;
  /**
   * Explicit day range (inclusive) — drives the calendar grid's extent so a
   * sparse or empty `series` still renders the full grid (a day with no
   * matching points is a real "$0 that day," not a missing cell). Callers
   * pass the same query range they requested data for.
   */
  range: { from: string; to: string };
}

function toDateKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Pure `Series[] → EChartsOption` mapping for the calendar-heatmap family
 * (ARCH-trends-calendar-budget.md, Trends Calendar panel). Reads only the
 * first series in `series` — the panel always requests exactly one measure
 * at `grain: "day"`. Missing days within `range` render as an explicit `0`
 * cell (a day with no activity really did cost $0 — distinct from the
 * "never fabricate 0" rule for *unavailable* measures, per `pointValue`'s
 * existing display-aggregation convention).
 */
export function buildCalendarHeatmapOption(
  series: Series[],
  { unit, range }: BuildCalendarHeatmapOptions,
): CalendarHeatmapOption {
  const [primary] = series;
  const data = (primary?.points ?? []).map((point) => [toDateKey(point.t), pointValue(point)]);
  const values = data.map(([, value]) => value as number);
  const max = values.length > 0 ? Math.max(...values, 0) : 0;

  return {
    tooltip: {
      formatter: (params: unknown) => {
        const p = params as { value?: [string, number] };
        if (!p.value) return "";
        return `${p.value[0]}: ${p.value[1]}`;
      },
    },
    visualMap: {
      min: 0,
      max: max > 0 ? max : 1,
      show: false,
      calculable: true,
      orient: "horizontal",
      inRange: { color: ["#1B222C", "#5c4a24", "#997429", "#E8A33D"] },
    },
    calendar: {
      range: [toDateKey(range.from), toDateKey(range.to)],
      cellSize: ["auto", 16],
      dayLabel: { firstDay: 1 },
      itemStyle: { borderWidth: 2, borderColor: "transparent" },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        name: primary ? `${primary.label} (${unit})` : unit,
        data,
      },
    ],
  };
}
