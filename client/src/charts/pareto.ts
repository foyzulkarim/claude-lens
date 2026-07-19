import type { LineSeriesOption } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import type { Distribution } from "../../../shared/metrics-contract.js";

export type ParetoOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption
>;

/**
 * Pure `Distribution["pareto"] → EChartsOption` mapping for the Pareto
 * "spend concentration" curve (ARCH-trends-calendar-budget.md; pages spec
 * §8). The server (`distributions.ts`'s `buildPareto`) already computes the
 * cumulative curve and top-decile share — this builder does no math of its
 * own, matching the "one engine serves every chart" rule (architecture §8).
 * `undefined` (a distribution with no `pareto`, e.g. an empty population)
 * renders an empty, still-valid chart rather than throwing.
 */
export function buildParetoOption(pareto: Distribution["pareto"] | undefined): ParetoOption {
  const curve = pareto?.curve ?? [];
  const data: [number, number][] = curve.map((point) => [
    point.entityPct,
    point.cumulativeValuePct,
  ]);

  return {
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) =>
        typeof value === "number" ? `${value.toFixed(1)}%` : String(value),
    },
    xAxis: {
      type: "value",
      name: "turns (%)",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    yAxis: {
      type: "value",
      name: "cumulative spend (%)",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" },
    },
    series: [
      {
        type: "line",
        name: "Cumulative spend",
        data,
        showSymbol: false,
        areaStyle: {},
      },
    ],
  };
}
