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

// Review #9: SubscriptionWindow now probes `/api/sessions` first to get the
// matched-history extent before firing the four `/api/metrics` hourly token
// queries. BurnRateCard still uses just /api/metrics, so only SubscriptionWindow
// depends on listSessions here.
const listSessionsMock =
  vi.fn<(params?: unknown, signal?: unknown) => Promise<SessionListResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessions: (params: unknown, signal: unknown) => listSessionsMock(params, signal),
}));

const { BurnRateCard } = await import("./BurnRateCard.js");
const { SubscriptionWindow } = await import("./SubscriptionWindow.js");

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

const NON_NULL_EXTENT: SessionListResponse = {
  items: [],
  total: 0,
  meta: {
    matchedExtent: { from: "2026-06-16T14:00:00.000Z", to: "2026-07-16T14:00:00.000Z" },
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
  // Ensure a broken `new Date()`-per-render implementation crosses a
  // millisecond boundary and produces a measurably different query key.
  postMetricsMock.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(EMPTY_SERIES), 5)),
  );
  listSessionsMock.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(NON_NULL_EXTENT), 5)),
  );
});

afterEach(() => {
  cleanup();
});

describe("live-window cards — stable default time", () => {
  it("does not create a new BurnRateCard query after its response renders", async () => {
    const queryClient = renderCard(<BurnRateCard />);

    await screen.findByLabelText("Month-to-date spend: $0.00");

    expect(postMetricsMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("does not create a new SubscriptionWindow query after its response renders", async () => {
    renderCard(<SubscriptionWindow />);

    // The card now shows token units (review #9): the ARIA label was
    // "$0.00" when the underlying series was `costComputed`; today it's the
    // summed hourly token counts across the four token measures.
    await screen.findByLabelText("5h window: 0 tokens");

    // 1 probe + 4 token queries; no refetch storm. The cache also holds
    // historical compareGhost placeholders from earlier renders, so we
    // assert mock call counts rather than cache length — that's the actual
    // refetch-storm signal.
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(postMetricsMock).toHaveBeenCalledTimes(4);
  });
});
