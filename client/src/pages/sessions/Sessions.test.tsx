// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ScatterMetricsResult, Series } from "../../../../shared/metrics-contract.js";
import type { SessionPageResponse } from "../../../../shared/sessions-contract.js";
import type { ChartProps } from "../../charts/Chart.js";

// Whole-page composition smoke test (ARCH T8). Same fetch-boundary
// mocking pattern as Dashboard.test.tsx: stub the API wrapper modules
// every section calls through, and stub the leaf Chart component (jsdom
// has no ResizeObserver / canvas backing).
const listSessionsPageMock = vi.fn<(params: unknown) => Promise<SessionPageResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessionsPage: (params: unknown) => listSessionsPageMock(params),
}));

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
const postScatterMetricsMock = vi.fn<(query: unknown) => Promise<ScatterMetricsResult>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
  postScatterMetrics: (query: unknown) => postScatterMetricsMock(query),
}));

vi.mock("../../charts/Chart.js", () => ({
  Chart: (_props: ChartProps) => <div data-testid="chart-stub" />,
}));

const { Sessions } = await import("../Sessions.js");

function emptyPageResponse(): SessionPageResponse {
  return {
    items: [],
    total: 0,
    meta: {
      matched: 0,
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

function emptyScatterResult(): ScatterMetricsResult {
  return {
    mode: "scatter",
    entity: "session",
    xMeasure: "costComputed",
    yMeasure: "wallMinutes",
    points: [],
    regression: null,
    population: {
      matched: 0,
      eligible: 0,
      returned: 0,
      excludedMissingMeasures: 0,
      sampled: false,
    },
  };
}

function renderSessions(search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: `/sessions${search}`, static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Sessions />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  listSessionsPageMock.mockReset();
  listSessionsPageMock.mockResolvedValue(emptyPageResponse());
  postMetricsMock.mockReset();
  postMetricsMock.mockResolvedValue([]);
  postScatterMetricsMock.mockReset();
  postScatterMetricsMock.mockResolvedValue(emptyScatterResult());
});

afterEach(() => {
  cleanup();
});

describe("Sessions — binding-order composition (ARCH R1)", () => {
  it("renders every binding section", async () => {
    renderSessions();

    // 1. Prompt search seam
    expect(screen.getByTestId("prompt-search-slot")).toBeInTheDocument();
    // 2. Filters
    expect(screen.getByTestId("sessions-filters")).toBeInTheDocument();
    // 3. Sessions table / browser
    expect(screen.getByTestId("session-browser")).toBeInTheDocument();
    // 5. Efficiency scatter
    await waitFor(() => expect(screen.getByTestId("efficiency-scatter-card")).toBeInTheDocument());
    // 6. Cost distribution
    expect(screen.getByTestId("cost-distribution-card")).toBeInTheDocument();
    // 7. Compare
    expect(screen.getByTestId("session-compare")).toBeInTheDocument();
    // 8. Tags seam
    expect(screen.getByTestId("tags-stub")).toBeInTheDocument();
  });

  it("compare/tags sections are present even though the mockup omits them (ARCH spec-vs-mockup gap)", async () => {
    renderSessions();
    expect(screen.getByTestId("session-compare")).toBeInTheDocument();
    expect(screen.getByTestId("tags-stub")).toBeInTheDocument();
  });

  it("keeps rendering every other section when the list query rejects", async () => {
    listSessionsPageMock.mockRejectedValue(new Error("sessions endpoint unreachable"));
    renderSessions();

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    // The rest of the page is still intact — one section's outage doesn't
    // unmount successful siblings (ARCH API-failure scenario).
    expect(screen.getByTestId("sessions-filters")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-search-slot")).toBeInTheDocument();
  });

  it("keeps rendering every other section when the scatter query rejects", async () => {
    postScatterMetricsMock.mockRejectedValue(new Error("scatter endpoint unreachable"));
    renderSessions();

    await waitFor(() =>
      expect(screen.getByText(/scatter endpoint unreachable/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId("session-browser")).toBeInTheDocument();
    expect(screen.getByTestId("cost-distribution-card")).toBeInTheDocument();
  });

  it("a Dashboard drill-in URL renders the population described by the incoming filters", async () => {
    renderSessions("?from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-10T00%3A00%3A00.000Z");
    await waitFor(() => expect(listSessionsPageMock).toHaveBeenCalled());
    const params = listSessionsPageMock.mock.calls[0]?.[0] as { from?: string; to?: string };
    expect(params.from).toBe("2026-07-01T00:00:00.000Z");
    expect(params.to).toBe("2026-07-10T00:00:00.000Z");
  });
});
