import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from "echarts/charts";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import type { GridComponentOption, TooltipComponentOption } from "echarts/components";
import { GridComponent, TooltipComponent } from "echarts/components";
import type { ComposeOption, ECElementEvent } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { TimeseriesOption } from "./timeseries.js";

// Register the time-series + scatter chart families (ARCH A9). The scatter
// addition is purely additive — existing line/bar consumers are untouched,
// and the lifecycle (`init`/`resize`/`setOption`/`on`/`dispose`) is shared
// across families.
echarts.use([LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);

/**
 * The widened chart option type — ARCH A9: "reusable unchanged by future
 * non-timeseries chart families (heatmap, scatter, …)". `TimeseriesOption`
 * is preserved as a strict superset of the existing call sites.
 */
export type ChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | ScatterSeriesOption
  | GridComponentOption
  | TooltipComponentOption
>;

export interface ChartProps {
  option: TimeseriesOption | ChartOption;
  onPointClick?: (params: ECElementEvent) => void;
  className?: string;
  /** Optional semantic summary for assistive technology and black-box UI checks. */
  ariaLabel?: string;
}

/**
 * Dumb ECharts lifecycle shell (ARCH-chart-layer-live-chart.md T2, decision
 * A3): mounts/updates/resizes/disposes a chart instance from an
 * `EChartsOption`. No data fetching, no business logic — reusable unchanged
 * by future non-timeseries chart families (heatmap, scatter, …). Never
 * imports from `api/` or `filters/` (Module Boundaries rule).
 */
export function Chart({ option, onPointClick, className, ariaLabel }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = echarts.init(container);
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onPointClick) return;
    chart.on("click", onPointClick);
    return () => {
      chart.off("click", onPointClick);
    };
  }, [onPointClick]);

  return (
    <div
      ref={containerRef}
      className={className}
      {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : {})}
    />
  );
}
