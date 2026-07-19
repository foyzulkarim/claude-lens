// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimeseriesOption } from "./timeseries.js";

const chartInstance = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("echarts/core", () => ({
  init: vi.fn(() => chartInstance),
  use: vi.fn(),
}));
vi.mock("echarts/charts", () => ({
  LineChart: {},
  BarChart: {},
  ScatterChart: {},
  HeatmapChart: {},
}));
vi.mock("echarts/components", () => ({
  GridComponent: {},
  TooltipComponent: {},
  CalendarComponent: {},
  VisualMapComponent: {},
}));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const { Chart } = await import("./Chart.js");
const echarts = await import("echarts/core");

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.observed = [];
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const option: TimeseriesOption = { series: [] };

beforeEach(() => {
  vi.clearAllMocks();
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Chart", () => {
  it("applies semantic image metadata when labeled", () => {
    render(<Chart option={option} ariaLabel="Cost over time chart; 1 series; total $3.00" />);
    expect(
      screen.getByRole("img", { name: "Cost over time chart; 1 series; total $3.00" }),
    ).toBeInTheDocument();
  });

  it("keeps unlabeled callers free of invented image metadata", () => {
    const { container } = render(<Chart option={option} />);
    expect(container.querySelector("[role='img']")).toBeNull();
    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("calls echarts.init once on mount, not again on re-render", () => {
    const { rerender } = render(<Chart option={option} />);
    expect(echarts.init).toHaveBeenCalledTimes(1);
    rerender(<Chart option={option} className="resized" />);
    expect(echarts.init).toHaveBeenCalledTimes(1);
  });

  it("applies the option via setOption on mount and when option changes", () => {
    const { rerender } = render(<Chart option={option} />);
    expect(chartInstance.setOption).toHaveBeenCalledWith(option, { notMerge: true });

    const nextOption: TimeseriesOption = { series: [{ type: "line", data: [] }] };
    rerender(<Chart option={nextOption} />);
    expect(chartInstance.setOption).toHaveBeenLastCalledWith(nextOption, { notMerge: true });
    expect(echarts.init).toHaveBeenCalledTimes(1);
  });

  it("wires the click handler when provided", () => {
    const onPointClick = vi.fn();
    render(<Chart option={option} onPointClick={onPointClick} />);
    expect(chartInstance.on).toHaveBeenCalledWith("click", onPointClick);
  });

  it("does not wire a click handler when omitted", () => {
    render(<Chart option={option} />);
    expect(chartInstance.on).not.toHaveBeenCalled();
  });

  it("resizes on container resize", () => {
    render(<Chart option={option} />);
    expect(FakeResizeObserver.instances).toHaveLength(1);
    FakeResizeObserver.instances[0]?.trigger();
    expect(chartInstance.resize).toHaveBeenCalledTimes(1);
    // Pin the exact count: setOption is applied once at mount and never
    // again on resize (resize must call chart.resize() only).
    expect(chartInstance.setOption).toHaveBeenCalledTimes(1);
  });

  it("disposes on unmount and disconnects the resize observer", () => {
    const { unmount } = render(<Chart option={option} />);
    const observer = FakeResizeObserver.instances[0];
    unmount();
    expect(chartInstance.dispose).toHaveBeenCalledTimes(1);
    expect(observer?.observed).toHaveLength(0);
  });
});
