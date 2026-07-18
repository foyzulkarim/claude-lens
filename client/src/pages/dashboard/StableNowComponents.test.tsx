// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
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

  it("AnomalyFeed fires exactly one query after first paint", async () => {
    const queryClient = renderCard(<AnomalyFeed />);
    await screen.findByText("Gate failure and capture-gap data not available yet.");
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });
});
