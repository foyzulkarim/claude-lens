// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";
import { paretoDecileRows } from "./ParetoPanel.js";

vi.mock("../../charts/Chart.js", () => ({
  Chart: (_props: ChartProps) => <div data-testid="chart-stub" />,
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { ParetoPanel } = await import("./ParetoPanel.js");

const NOW = new Date("2026-07-16T14:00:00.000Z");

function distributionSeries(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "all",
      label: "All",
      points: [],
      distribution: {
        p50: 1,
        p90: 5,
        p99: 10,
        histogram: [],
        pareto: {
          curve: [
            { entityPct: 10, cumulativeValuePct: 60 },
            { entityPct: 50, cumulativeValuePct: 90 },
            { entityPct: 100, cumulativeValuePct: 100 },
          ],
          topDecileValuePct: 60,
        },
      },
    },
  ];
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/trends", static: true });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <ParetoPanel now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("paretoDecileRows", () => {
  it("picks the nearest-below curve point for each 10% mark", () => {
    const rows = paretoDecileRows([
      { entityPct: 10, cumulativeValuePct: 60 },
      { entityPct: 50, cumulativeValuePct: 90 },
      { entityPct: 100, cumulativeValuePct: 100 },
    ]);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toEqual({ decile: 10, cumulativeValuePct: 60 });
    expect(rows[3]).toEqual({ decile: 40, cumulativeValuePct: 60 });
    expect(rows[4]).toEqual({ decile: 50, cumulativeValuePct: 90 });
    expect(rows[9]).toEqual({ decile: 100, cumulativeValuePct: 100 });
  });

  it("returns 0 rows gracefully for an empty curve", () => {
    const rows = paretoDecileRows([]);
    expect(rows.every((r) => r.cumulativeValuePct === 0)).toBe(true);
  });
});

describe("ParetoPanel", () => {
  it("requests a turn-entity distribution query", async () => {
    postMetricsMock.mockResolvedValue(distributionSeries());
    renderPanel();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalled());
    expect(postMetricsMock.mock.calls[0][0]).toMatchObject({
      mode: "distribution",
      distributionEntity: "turn",
    });
  });

  it("shows the top-decile summary text and defaults to the curve view", async () => {
    postMetricsMock.mockResolvedValue(distributionSeries());
    renderPanel();
    await waitFor(() =>
      expect(screen.getByText(/Top 10% of turns = 60% of spend/)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("chart-stub")).toBeInTheDocument();
  });

  it("switches to the decile table on toggle", async () => {
    postMetricsMock.mockResolvedValue(distributionSeries());
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "table" }));
    await waitFor(() => expect(screen.getByText("Cumulative spend (%)")).toBeInTheDocument());
  });

  it("surfaces a fetch error", async () => {
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });
});
