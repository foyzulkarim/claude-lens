import type { ScatterSeriesOption } from "echarts/charts";
import type { ScatterPoint, ScatterRegression } from "../../../shared/metrics-contract.js";

/** ECharts scatter-series option builder (ARCH A9 — pages-spec §2 row 5).
 * Pure: takes the server-produced `ScatterMetricsResult.points` +
 * `regression`, returns an ECharts-friendly option. No data fetching, no
 * aggregation, no DOM. The x/y labels follow the page convention
 * (costComputed / wallMinutes / totalTokens / cacheHitPct / turns).
 *
 * When `sizeMeasure` is set on the source query, the matching point's
 * `.size` value scales the ECharts `symbolSize` between
 * `MIN_SYMBOL_SIZE` (zero/unavailable/zero-sized points) and
 * `MAX_SYMBOL_SIZE` (the largest observed size). When unset, every point
 * falls back to the constant `DEFAULT_SYMBOL_SIZE`. */
export interface BuildScatterOptions {
  xLabel: string;
  yLabel: string;
  /** `true` when the source query requested a size measure; drives the
   * per-point size scaling below. */
  hasSize?: boolean;
}

const MIN_SYMBOL_SIZE = 6;
const MAX_SYMBOL_SIZE = 28;
const DEFAULT_SYMBOL_SIZE = 8;

export function buildScatterOption(
  points: ScatterPoint[],
  regression: ScatterRegression | null,
  { xLabel, yLabel, hasSize = false }: BuildScatterOptions,
): {
  tooltip: { trigger: "item" };
  xAxis: { name: string; nameLocation: "middle"; nameGap: 28; type: "value" };
  yAxis: { name: string; nameLocation: "middle"; nameGap: 42; type: "value" };
  series: ScatterSeriesOption[];
} {
  const maxSize = hasSize ? maxRawSize(points) : 0;
  const data: (number | null | string)[][] = points.map((p) => {
    const symbolSize = hasSize ? scaledSymbolSize(p.size, maxSize) : DEFAULT_SYMBOL_SIZE;
    // ECharts passes the encoded tuple through to the formatter; the
    // third slot becomes the tooltip label so users see a session id
    // when they hover (used by the Explore page's drill handler).
    return [p.x, p.y, p.sessionId, symbolSize];
  });

  const series: ScatterSeriesOption[] = [
    {
      type: "scatter",
      data,
      // ECharts honours a per-point symbolSize when the data tuple has a
      // 4th slot — sized points show up larger, unsized points render at
      // the DEFAULT_SYMBOL_SIZE passed via the constant above.
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
 * Largest finite positive `.size` across `points` — used as the upper
 * bound for the size-symbol scaling. Returns 0 when no point carries a
 * usable size (the caller then renders every point at MIN_SYMBOL_SIZE).
 */
function maxRawSize(points: ScatterPoint[]): number {
  let max = 0;
  for (const p of points) {
    const v = p.size;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
    if (v > max) max = v;
  }
  return max;
}

/**
 * Linear [0, maxSize] → [MIN_SYMBOL_SIZE, MAX_SYMBOL_SIZE]. Caller is
 * responsible for `maxSize` — the largest observed `size` across the
 * visible points. Both bounded so a single huge point doesn't crush
 * every other one to invisibility. Null/undefined/zero/negative values
 * collapse to the minimum so the canvas stays visually dense even when
 * size data is patchy.
 */
function scaledSymbolSize(value: number | null | undefined, maxSize: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || maxSize <= 0) {
    return MIN_SYMBOL_SIZE;
  }
  return MIN_SYMBOL_SIZE + (value / maxSize) * (MAX_SYMBOL_SIZE - MIN_SYMBOL_SIZE);
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
