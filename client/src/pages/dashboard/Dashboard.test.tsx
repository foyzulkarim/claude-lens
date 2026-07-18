// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { SessionListResponse } from "../../../../shared/sessions-contract.js";
import type { ChartProps } from "../../charts/Chart.js";

// Same fetch-boundary mocking pattern as every other T7-T13 section test
// (see AnomalyFeed.test.tsx / LeaderboardsCard.test.tsx): stub the two API
// wrapper modules every section ultimately calls through, rather than
// window.fetch directly, so each section's own query resolves without a
// network call.
const listSessionsMock = vi.fn<(params: unknown) => Promise<SessionListResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessions: (params: unknown) => listSessionsMock(params),
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

// Same real-ECharts-avoidance pattern as ChartCard.test.tsx: jsdom has no
// ResizeObserver and no canvas backing, so the Dashboard smoke test stubs
// the leaf Chart component rather than rendering real ECharts.
vi.mock("../../charts/Chart.js", () => ({
  Chart: (_props: ChartProps) => <div data-testid="chart-stub" />,
}));

const { Dashboard } = await import("../Dashboard.js");

function emptySessionsResponse(): SessionListResponse {
  return {
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
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Dashboard />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue(emptySessionsResponse());
  postMetricsMock.mockReset();
  postMetricsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("Dashboard — 12-section smoke composition", () => {
  it("renders all 12 sections", async () => {
    renderDashboard();

    // 1. Stat cards row
    expect(screen.getByRole("region", { name: "Key stats" })).toBeInTheDocument();
    // 2. Cost-over-time chart
    expect(screen.getByTestId("chart-card")).toBeInTheDocument();
    // 3. Burn-rate card
    expect(screen.getByTestId("burn-rate-card")).toBeInTheDocument();
    // 4. Most recent session card
    expect(screen.getByRole("region", { name: "Most recent session" })).toBeInTheDocument();
    // 5. Leaderboards
    expect(screen.getByTestId("leaderboards-card")).toBeInTheDocument();
    // 6. Anomaly & gate-failure feed
    expect(screen.getByTestId("anomaly-feed")).toBeInTheDocument();
    // 7. Records strip
    expect(screen.getByTestId("records-strip")).toBeInTheDocument();
    // 8. Subscription window tracker
    expect(screen.getByTestId("subscription-window")).toBeInTheDocument();
    // 9. Leverage ratio headline
    expect(screen.getByText("Cache leverage")).toBeInTheDocument();
    // 10. Savings decomposition
    expect(screen.getByTestId("savings-decomposition")).toBeInTheDocument();
    // 11. Failed-work stat
    expect(screen.getByText("Failed work")).toBeInTheDocument();
    // 12. Capture banner (shown here — mocked globalCapture is all-false)
    await waitFor(() => expect(screen.getByTestId("capture-banner")).toBeInTheDocument());
  });

  it("keeps rendering every other section when one section's query rejects", async () => {
    // Break only the sessions-list endpoint (RecentSessionCard, the
    // sessions-based half of LeaderboardsCard/AnomalyFeed/RecordsStrip) —
    // postMetrics-backed sections (ChartCard, BurnRateCard, StatCardsRow,
    // SavingsDecomposition, LeverageRatio, FailedWorkStat) keep resolving,
    // proving one endpoint's outage doesn't blank the rest of the page.
    listSessionsMock.mockRejectedValue(new Error("sessions endpoint unreachable"));

    renderDashboard();

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/sessions endpoint unreachable/).length).toBeGreaterThan(0);
    // The rest of the page is still intact, not blanked by the sessions failure.
    expect(screen.getByTestId("chart-card")).toBeInTheDocument();
    expect(screen.getByTestId("burn-rate-card")).toBeInTheDocument();
    expect(screen.getByTestId("savings-decomposition")).toBeInTheDocument();
    expect(screen.getByText("Failed work")).toBeInTheDocument();
  });
});
