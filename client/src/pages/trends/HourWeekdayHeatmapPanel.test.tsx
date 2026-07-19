// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";

const chartSpy = vi.fn();
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: ChartProps) => {
    chartSpy(props);
    return <div data-testid="chart-stub" />;
  },
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { HourWeekdayHeatmapPanel } = await import("./HourWeekdayHeatmapPanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <HourWeekdayHeatmapPanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HourWeekdayHeatmapPanel", () => {
  it("requests an hour-grain query", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    expect(postMetricsMock.mock.calls[0][0]).toMatchObject({
      measures: ["costComputed"],
      dimensions: ["time"],
      grain: "hour",
    });
  });

  it("shows a loading state, then renders the chart", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
  });

  it("surfaces a fetch error", async () => {
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("passes a bucketed 168-cell grid to the chart", async () => {
    postMetricsMock.mockResolvedValue([
      {
        measure: "costComputed",
        dimensionKey: "time",
        label: "Cost",
        points: [{ t: "2026-07-01T14:00:00.000Z", value: 10 }],
      },
    ]);
    renderPanel();
    await waitFor(() => expect(chartSpy).toHaveBeenCalled());
    const option = chartSpy.mock.calls.at(-1)?.[0].option;
    expect(option.series[0].data).toHaveLength(168);
  });
});
