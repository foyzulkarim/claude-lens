import type { ScatterSeriesOption } from "echarts/charts";
import type { ScatterPoint, ScatterRegression } from "../../../shared/metrics-contract.js";

/** ECharts scatter-series option builder (ARCH A9 — pages-spec §2 row 5).
 * Pure: takes the server-produced `ScatterMetricsResult.points` +
 * `regression`, returns an ECharts-friendly option. No data fetching, no
 * aggregation, no DOM. The x/y labels follow the page convention
 * (costComputed / wallMinutes / totalTokens / cacheHitPct / turns). */
export interface BuildScatterOptions {
  xLabel: string;
  yLabel: string;
}

export function buildScatterOption(
  points: ScatterPoint[],
  regression: ScatterRegression | null,
  { xLabel, yLabel }: BuildScatterOptions,
): {
  tooltip: { trigger: "item" };
  xAxis: { name: string; nameLocation: "middle"; nameGap: 28; type: "value" };
  yAxis: { name: string; nameLocation: "middle"; nameGap: 42; type: "value" };
  series: ScatterSeriesOption[];
} {
  const series: ScatterSeriesOption[] = [
    {
      type: "scatter",
      symbolSize: 8,
      data: points.map((p) => [p.x, p.y, p.sessionId]),
      emphasis: { focus: "series" },
    },
  ];
  if (regression !== null) {
    // ECharts' ScatterSeriesOption doesn't carry `lineStyle`; the
    // dashed-regression line is rendered as a second scatter series of
    // (xMin, y1)/(xMax, y2) and styled via itemStyle so it stays within
    // the scatter family. Visible opacity / dash emulation: a faint
    // narrow point.
    series.push({
      type: "scatter",
      symbolSize: 2,
      data: regressionLinePoints(points, regression),
      silent: true,
      name: "Regression",
      itemStyle: { color: "#94a3b8", opacity: 0.7 },
    });
  }
  return {
    tooltip: { trigger: "item" },
    xAxis: { name: xLabel, nameLocation: "middle", nameGap: 28, type: "value" },
    yAxis: { name: yLabel, nameLocation: "middle", nameGap: 42, type: "value" },
    series,
  };
}

/**
 * Two-point regression line spanning the visible point set's xMin/xMax
 * (pure). The page's visible points already represent the canvas range;
 * we don't have to plumb xMin/xMax separately.
 */
function regressionLinePoints(
  points: ScatterPoint[],
  regression: ScatterRegression,
): [number, number][] {
  if (points.length === 0) return [];
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const p of points) {
    if (typeof p.x !== "number" || !Number.isFinite(p.x)) continue;
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) return [];
  return [
    [xMin, regression.slope * xMin + regression.intercept],
    [xMax, regression.slope * xMax + regression.intercept],
  ];
}
