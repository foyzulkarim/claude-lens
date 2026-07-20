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

const { GatePassRatePanel } = await import("./GatePassRatePanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <GatePassRatePanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GatePassRatePanel", () => {
  it("requests the gatePassRate measure at week grain (the measure-presence contract)", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    expect(postMetricsMock.mock.calls[0][0]).toMatchObject({
      measures: ["gatePassRate"],
      grain: "week",
    });
  });

  it("renders a status loading affordance while the fetch is pending", () => {
    postMetricsMock.mockReturnValue(new Promise(() => {}) as never);
    renderPanel();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/loading/i);
  });

  it("renders an alert with the error message when the fetch fails", async () => {
    postMetricsMock.mockRejectedValue(new Error("metrics offline"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("metrics offline"));
  });

  it("renders the chart stub on success with the section data-testid", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    expect(screen.getByTestId("gate-pass-rate-panel")).toBeInTheDocument();
  });

  it("does not render the chart while loading or on error", async () => {
    // Loading
    postMetricsMock.mockReturnValue(new Promise(() => {}) as never);
    renderPanel();
    expect(screen.queryByTestId("chart-stub")).toBeNull();
    cleanup();

    // Error
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("chart-stub")).toBeNull();
  });
});
