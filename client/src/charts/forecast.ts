import type { LineSeriesOption } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";

export type ForecastBandOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption
>;

export interface ForecastPoint {
  t: string;
  value: number;
}

/**
 * Month-end spend forecast (ARCH-trends-calendar-budget.md; pages spec §8
 * Budget + Forecast, collapsed into one combined panel per decision A2).
 * Computed by `pages/trends/forecast.ts`'s `computeForecast`; this module
 * only owns the wire shape so the chart builder never depends on page code.
 */
export interface MonthForecast {
  mtd: number;
  method: "linear" | "ewma";
  /** `null` when fewer than `MIN_DAYS_FOR_PROJECTION` days of data exist — a projection off 1-2 points is noise, not a forecast. */
  projectedEndOfMonth: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  budget: number | null;
  /** First date (ISO, UTC midnight) the *upper* (worst-case) band trajectory is projected to cross `budget`; `null` if it never does or no budget is set. */
  crossesBudgetAt: string | null;
}

const GHOST_LINE_STYLE = { type: "dashed" as const, opacity: 0.5 };
const BUDGET_LINE_COLOR = "#B23A3A";

/**
 * Pure builder for the combined Budget + Forecast panel's chart
 * (ARCH-trends-calendar-budget.md A2/A4): a solid "actual" cumulative-spend
 * line, a dashed projected continuation to month-end, a shaded confidence
 * band (the classic ECharts stacked-invisible-base + visible-range trick),
 * and — when a budget is set — a dashed horizontal cap line. All the actual
 * math (`projectedEndOfMonth`/`bandLow`/`bandHigh`) already happened in
 * `pages/trends/forecast.ts`'s `computeForecast`; this builder only maps
 * that result plus the already-fetched cumulative actuals onto an
 * `EChartsOption`. Never throws on an empty `actual` array or a `forecast`
 * with null projection (fewer than 3 days of MTD data) — it just renders
 * the actual line alone.
 */
export function buildForecastBandOption(
  actual: ForecastPoint[],
  forecast: MonthForecast,
  monthEndDate: string,
): ForecastBandOption {
  const series: LineSeriesOption[] = [
    {
      type: "line",
      name: "Actual",
      data: actual.map((p) => [p.t, p.value]),
      showSymbol: false,
    },
  ];

  const lastActual = actual[actual.length - 1];

  if (lastActual && forecast.projectedEndOfMonth !== null) {
    series.push({
      type: "line",
      name: "Projected",
      data: [
        [lastActual.t, lastActual.value],
        [monthEndDate, forecast.projectedEndOfMonth],
      ],
      lineStyle: GHOST_LINE_STYLE,
      showSymbol: false,
    });
  }

  if (lastActual && forecast.bandLow !== null && forecast.bandHigh !== null) {
    series.push(
      {
        type: "line",
        name: "Band (low)",
        data: [
          [lastActual.t, forecast.bandLow],
          [monthEndDate, forecast.bandLow],
        ],
        stack: "band",
        lineStyle: { opacity: 0 },
        showSymbol: false,
        tooltip: { show: false },
      },
      {
        type: "line",
        name: "Band (range)",
        data: [
          [lastActual.t, 0],
          [monthEndDate, forecast.bandHigh - forecast.bandLow],
        ],
        stack: "band",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0.12 },
        showSymbol: false,
        tooltip: { show: false },
      },
    );
  }

  if (forecast.budget !== null) {
    series.push({
      type: "line",
      name: "Budget cap",
      data: [],
      markLine: {
        symbol: "none",
        silent: true,
        lineStyle: { type: "dashed", color: BUDGET_LINE_COLOR },
        data: [{ yAxis: forecast.budget }],
      },
    });
  }

  return {
    tooltip: { trigger: "axis" },
    xAxis: { type: "time" },
    yAxis: { type: "value" },
    series,
  };
}
