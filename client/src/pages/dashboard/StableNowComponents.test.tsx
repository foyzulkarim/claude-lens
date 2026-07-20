// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { AppConfig } from "../../../../shared/settings-contract.js";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const listSessionsMock =
  vi.fn<(params?: unknown, signal?: unknown) => Promise<SessionListResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessions: (params: unknown, signal: unknown) => listSessionsMock(params, signal),
}));

const getConfigMock = vi.fn<() => Promise<AppConfig>>();
vi.mock("../../api/config.js", () => ({
  getConfig: () => getConfigMock(),
}));

// AnomalyFeed's gate-failure feed (#P4-12 / review #13/#29): the new
// `gateFailuresQuery` would otherwise fail to resolve and trip the
// loading-state branch the test wasn't expecting. Mirror the same
// settled-empty default the AnomalyFeed.test.tsx uses.
const fetchWorstGateFailuresMock = vi.fn<() => Promise<unknown[]>>();
vi.mock("../../api/gate-failures.js", () => ({
  fetchWorstGateFailures: () => fetchWorstGateFailuresMock(),
}));

// ChartCard renders real ECharts via <Chart>, which needs a ResizeObserver
// and real layout jsdom doesn't provide — stub it out like ChartCard.test.tsx
// does, so these tests exercise ChartCard's query wiring, not the canvas.
vi.mock("../../charts/Chart.js", () => ({
  Chart: () => <div data-testid="chart-stub" />,
}));

import { ChartCard } from "../../charts/ChartCard.js";
import { AnomalyFeed } from "./AnomalyFeed.js";
import { FailedWorkStat } from "./FailedWorkStat.js";
import { LeaderboardsCard } from "./LeaderboardsCard.js";
import { LeverageRatio } from "./LeverageRatio.js";
import { RecentSessionCard } from "./RecentSessionCard.js";
import { SavingsDecomposition } from "./SavingsDecomposition.js";
import { StatCardsRow } from "./StatCardsRow.js";

function renderCard(card: ReactElement): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        {card}
      </Router>
    </QueryClientProvider>,
  );
  return queryClient;
}

const EMPTY_SERIES: Series[] = [];

const EMPTY_SESSION_LIST: SessionListResponse = {
  items: [],
  total: 0,
  meta: {
    matchedExtent: null,
    globalCapture: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
    captureSummary: { capturingSessions: 0, lastCapturedAt: null },
  },
};

beforeEach(() => {
  postMetricsMock.mockReset();
  listSessionsMock.mockReset();
  // Tiny async delay so a broken `new Date()`-per-render implementation
  // would cross a millisecond boundary and re-fire a query before the test
  // asserts "exactly one query".
  postMetricsMock.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(EMPTY_SERIES), 5)),
  );
  listSessionsMock.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(EMPTY_SESSION_LIST), 5)),
  );
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue({ budget: null });
  fetchWorstGateFailuresMock.mockReset();
  fetchWorstGateFailuresMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("dashboard cards — stable default time (review #4)", () => {
  // These guard the same bug class the PR's two follow-up commits fixed in
  // BurnRateCard/SubscriptionWindow: a bare `new Date()` inside a useMemo
  // gated only on `filtersKey` freezes the resolved time at mount, and
  // since `serializeFilters` omits the default preset, `filtersKey` doesn't
  // tick forward either. The dashboard silently stopped reflecting newer
  // activity — covered here for all 7 sibling components.
  it("StatCardsRow fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<StatCardsRow />);
    await screen.findByLabelText("Spend: $0.00 — view in Trends");
    expect(postMetricsMock).toHaveBeenCalledTimes(2); // coreQuery + tokensQuery
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
  });

  it("SavingsDecomposition fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<SavingsDecomposition />);
    await screen.findByTestId("savings-total");
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("RecentSessionCard fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<RecentSessionCard />);
    await screen.findByText("No sessions match the current filters.");
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("LeverageRatio fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<LeverageRatio />);
    await screen.findByText("Cache leverage");
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("FailedWorkStat fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<FailedWorkStat />);
    await screen.findByText("Failed work");
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("LeaderboardsCard fires exactly one query (sessions tab) after first paint", async () => {
    renderCard(<LeaderboardsCard initialTab="sessions" />);
    await screen.findByRole("table", { name: "Top sessions by cost" });
    // initialTab=sessions disables projects/models queries; only the
    // sessions listSessions() fetch should fire.
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(postMetricsMock).toHaveBeenCalledTimes(0);
  });

  it("AnomalyFeed fires exactly one sessions query + one config query after first paint", async () => {
    const queryClient = renderCard(<AnomalyFeed />);
    await screen.findByText("No anomalies or gate failures detected.");
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    // sessions + config (#P4-15) + gate-failures (#P4-12) — the third query
    // is unmocked here (`listSessionsPage` isn't stubbed in this file) so it
    // rejects, but AnomalyFeed degrades gracefully and still renders the
    // empty state.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(3);
  });

  it("ChartCard fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<ChartCard title="Cost over time" defaultUnit="$" />);
    await screen.findByTestId("chart-stub");
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("ChartCard rolls its range forward when its injected time changes", async () => {
    // Pre-fix, ChartCard's query memo called `new Date()` directly instead
    // of routing through `useStableNow` — since the memo's dependency array
    // never included that call's result, the captured value froze at mount
    // forever, and the query never rolled its default preset range forward.
    // This pins the component's injected-time seam. The hook's real
    // interval-driven behavior is covered separately in useStableNow.test.tsx.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook, searchHook } = memoryLocation({ path: "/", static: true });
    const initialNow = new Date("2026-07-16T12:00:00.000Z");
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <ChartCard title="Cost over time" defaultUnit="$" now={initialNow} />
        </Router>
      </QueryClientProvider>,
    );
    await screen.findByTestId("chart-stub");
    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    const firstRange = (postMetricsMock.mock.calls[0][0] as { range: { to: string } }).range;
    expect(firstRange.to).toBe(initialNow.toISOString());

    const tickedNow = new Date(initialNow.getTime() + 60_000);
    rerender(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <ChartCard title="Cost over time" defaultUnit="$" now={tickedNow} />
        </Router>
      </QueryClientProvider>,
    );
    await vi.waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(2));
    const secondRange = (postMetricsMock.mock.calls[1][0] as { range: { to: string } }).range;
    expect(secondRange.to).toBe(tickedNow.toISOString());
    expect(secondRange.to).not.toBe(firstRange.to);
  });
});
