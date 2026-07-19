import type { HeatmapSeriesOption } from "echarts/charts";
import type {
  GridComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from "echarts/components";
import type { ComposeOption } from "echarts/core";

export type HourWeekdayHeatmapOption = ComposeOption<
  HeatmapSeriesOption | GridComponentOption | VisualMapComponentOption | TooltipComponentOption
>;

/**
 * One cell of the "when do I burn money" grid (ARCH-trends-calendar-budget.md,
 * A1: pure client-side timestamp math, no new engine `Dimension`).
 * `weekday` is Monday-first (`0` = Monday … `6` = Sunday, matching the
 * mockup's M/W/F/S row labels); `hour` is the UTC hour-of-day (`0`-`23`,
 * consistent with the engine's UTC bucket boundaries — same "UTC-pinned"
 * convention `ChartCard.tsx`'s `RANGE_DATE_FORMAT` documents).
 */
export interface HourWeekdayCell {
  hour: number;
  weekday: number;
  value: number;
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => String(hour));
// Monday-first, matching `hourWeekdayBuckets.ts`'s weekday convention.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Pure `HourWeekdayCell[] → EChartsOption` mapping for the hour×weekday
 * cartesian-heatmap family (ARCH-trends-calendar-budget.md, "When do I burn
 * money" panel). Always renders the full 24×7 grid `bucketHourWeekday`
 * already produces densely — never throws on an empty `cells` input (every
 * cell just reads `0`).
 */
export function buildHourWeekdayHeatmapOption(cells: HourWeekdayCell[]): HourWeekdayHeatmapOption {
  const data = cells.map((cell) => [cell.hour, cell.weekday, cell.value]);
  const max = data.length > 0 ? Math.max(...data.map((d) => d[2] as number), 0) : 0;

  return {
    tooltip: {
      formatter: (params: unknown) => {
        const p = params as { value?: [number, number, number] };
        if (!p.value) return "";
        const [hour, weekday, value] = p.value;
        return `${WEEKDAY_LABELS[weekday]} ${hour}:00 — ${value}`;
      },
    },
    grid: { top: 20, left: 40, right: 10, bottom: 20 },
    xAxis: { type: "category", data: HOUR_LABELS, splitArea: { show: true } },
    yAxis: { type: "category", data: WEEKDAY_LABELS, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max: max > 0 ? max : 1,
      show: false,
      calculable: true,
      inRange: { color: ["#1B222C", "#5c4a24", "#997429", "#E8A33D"] },
    },
    series: [
      {
        type: "heatmap",
        data,
      },
    ],
  };
}
