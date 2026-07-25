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
 * (ARCH-trends-calendar-budget.md, Trends Calendar panel). Sums *every*
 * returned series into one value per day: the panel requests whichever
 * measures its active unit maps to, and since issue #122 `tokens` is four
 * of them. Reading `series[0]` alone (the previous behavior, correct only
 * while every unit was single-measure) silently plotted `inputTokens` —
 * the uncached prompt slice, typically single digits per call.
 *
 * Missing days within `range` render as an explicit `0` cell (a day with no
 * activity really did cost $0 — distinct from the "never fabricate 0" rule
 * for *unavailable* measures, per `pointValue`'s existing display-
 * aggregation convention).
 */
export function buildCalendarHeatmapOption(
  series: Series[],
  { unit, range }: BuildCalendarHeatmapOptions,
): CalendarHeatmapOption {
  // Buckets align across the measures of a single query (architecture
  // decision A5), so folding by date key needs no index alignment.
  const byDate = new Map<string, number>();
  for (const s of series) {
    for (const point of s.points) {
      const key = toDateKey(point.t);
      byDate.set(key, (byDate.get(key) ?? 0) + pointValue(point));
    }
  }
  const data = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => [date, value]);
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
        // Names the aggregate, not `series[0].label` — with four token
        // series all labeled "All", the old name described one band of a
        // total (#122).
        name: `Total (${unit})`,
        data,
      },
    ],
  };
}
