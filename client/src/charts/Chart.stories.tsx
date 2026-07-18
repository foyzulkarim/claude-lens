import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { ScatterPoint } from "../../../shared/metrics-contract.js";
import { Chart } from "./Chart.js";
import { buildScatterOption } from "./scatterOption.js";
import type { ChartProps } from "./Chart.js";
import type { TimeseriesOption } from "./timeseries.js";

// Real ECharts, no mocks — human-verified per ARCH-chart-layer-live-chart.md
// T2 (bundle hygiene, resize, click interaction are not practically
// unit-testable against the real renderer).
const points: [string, number][] = [
  ["2026-07-08", 12],
  ["2026-07-09", 18],
  ["2026-07-10", 9],
  ["2026-07-11", 22],
  ["2026-07-12", 15],
  ["2026-07-13", 27],
  ["2026-07-14", 19],
];

const areaOption: TimeseriesOption = {
  tooltip: { trigger: "axis" },
  xAxis: { type: "category", data: points.map(([t]) => t) },
  yAxis: { type: "value" },
  series: [{ type: "line", name: "Cost", data: points.map(([, v]) => v), areaStyle: {} }],
};

const barOption: TimeseriesOption = {
  ...areaOption,
  series: [{ type: "bar", name: "Cost", data: points.map(([, v]) => v) }],
};

function scatterStoryOption(): ChartProps["option"] {
  const scatterPoints: ScatterPoint[] = Array.from({ length: 60 }, (_, i) => ({
    sessionId: `s${i}`,
    x: i * 0.5 + Math.sin(i) * 2,
    y: i * 0.4 + Math.cos(i) * 3 + 5,
  }));
  return buildScatterOption(
    scatterPoints,
    { slope: 0.8, intercept: 0.5, rSquared: 0.82 },
    {
      xLabel: "Cost ($)",
      yLabel: "Duration (min)",
    },
  );
}

const meta: Meta<typeof Chart> = {
  title: "Charts/Chart",
  component: Chart,
  args: {
    className: "h-80 w-full",
    onPointClick: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof Chart>;

export const Area: Story = {
  args: { option: areaOption },
};

export const Bars: Story = {
  args: { option: barOption },
};

export const ScatterFamily: Story = {
  args: {
    option: scatterStoryOption(),
    ariaLabel: "Scatter chart; 60 sessions; cost × duration",
  },
};
