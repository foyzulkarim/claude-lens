// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { ChartProps } from "../../charts/Chart.js";
import { DEFAULT_SESSIONS_PAGE_STATE } from "./state.js";

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

const { CostDistributionCard } = await import("./CostDistributionCard.js");

function distributionSeries(): Series[] {
  return [
    {
      measure: "costComputed",
      dimensionKey: "all",
      label: "All",
      points: [],
      distribution: {
        p50: 1.5,
        p90: 4.2,
        p99: 9.9,
        histogram: [
          { rangeStart: 0, rangeEnd: 1, count: 2 },
          { rangeStart: 1, rangeEnd: 2, count: 5 },
        ],
      },
    },
  ];
}

function renderCard(state = DEFAULT_SESSIONS_PAGE_STATE, onStateChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/sessions", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <CostDistributionCard
          state={state}
          onStateChange={onStateChange}
          now={new Date("2026-07-15T00:00:00Z")}
        />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return { ...render(tree), onStateChange };
}

beforeEach(() => {
  postMetricsMock.mockReset();
  postMetricsMock.mockResolvedValue(distributionSeries());
  chartSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("CostDistributionCard — histogram/percentile toggle over one result", () => {
  it("renders the histogram view by default", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    // Only one postMetrics call regardless of the default view.
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
  });

  it("clicking percentiles does not trigger a refetch — display-only toggle over one result", async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /percentiles/i }));
    // Toggling the view is display-only (the parent owns `state` and
    // re-renders with the new distributionView; this component itself
    // never re-fetches on a view-toggle click).
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
  });

  it("renders p50/p90/p99 values in the percentiles view", async () => {
    renderCard({ ...DEFAULT_SESSIONS_PAGE_STATE, distributionView: "percentiles" });
    await waitFor(() => expect(screen.getByText("$1.50")).toBeInTheDocument());
    expect(screen.getByText("$4.20")).toBeInTheDocument();
    expect(screen.getByText("$9.90")).toBeInTheDocument();
  });

  it("renders an honest empty state when no distribution is present", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderCard();
    await waitFor(() => expect(screen.getByText(/no distribution data/i)).toBeInTheDocument());
  });

  it("renders the error boundary independently of other sections", async () => {
    postMetricsMock.mockRejectedValue(new Error("distribution endpoint unreachable"));
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/unreachable/i));
  });

  it("clicking the histogram/percentiles buttons calls onStateChange", async () => {
    const user = userEvent.setup();
    const { onStateChange } = renderCard();
    await waitFor(() => expect(screen.getByTestId("chart-stub")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /percentiles/i }));
    expect(onStateChange).toHaveBeenCalledWith({ distributionView: "percentiles" });
  });
});
