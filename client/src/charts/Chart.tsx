import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import type { ECElementEvent } from "echarts/core";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import type { TimeseriesOption } from "./timeseries.js";

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export interface ChartProps {
  option: TimeseriesOption;
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
