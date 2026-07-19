// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
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

const NULL_EXTENT: SessionListResponse = {
  ...NON_NULL_EXTENT,
  meta: { ...NON_NULL_EXTENT.meta, matchedExtent: null },
};

const WINDOW_EXTENT: SessionListResponse = {
  ...NON_NULL_EXTENT,
  meta: {
    ...NON_NULL_EXTENT.meta,
    matchedExtent: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-10T12:00:00.000Z" },
  },
};

const INPUT_TOKEN_POINTS = [
  { t: "2026-07-01T00:00:00.000Z", value: 100 },
  { t: "2026-07-01T01:00:00.000Z", value: 100 },
  { t: "2026-07-01T02:00:00.000Z", value: 100 },
  { t: "2026-07-01T03:00:00.000Z", value: 100 },
  { t: "2026-07-01T04:00:00.000Z", value: 100 },
  { t: "2026-07-01T05:00:00.000Z", value: 0 },
  { t: "2026-07-10T08:00:00.000Z", value: 20 },
  { t: "2026-07-10T09:00:00.000Z", value: 30 },
  { t: "2026-07-10T10:00:00.000Z", value: 40 },
  { t: "2026-07-10T11:00:00.000Z", value: 60 },
];

function installWindowSeries(): void {
  listSessionsMock.mockResolvedValue(WINDOW_EXTENT);
  postMetricsMock.mockImplementation(async (rawQuery) => {
    const query = rawQuery as SeriesMetricsQuery;
    const measure = query.measures[0];
    if (!measure) return [];
    return [
      {
        measure,
        dimensionKey: "",
        label: measure,
        points: measure === "inputTokens" ? INPUT_TOKEN_POINTS : [],
      },
    ];
  });
}

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

  it("skips every metrics request and renders an honest empty state for a null extent", async () => {
    listSessionsMock.mockResolvedValue(NULL_EXTENT);
    postMetricsMock.mockResolvedValue(EMPTY_SERIES);

    renderCard(<SubscriptionWindow />);

    await screen.findByText(
      "No sessions in scope yet — start a Claude session to begin tracking usage.",
    );
    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(postMetricsMock).not.toHaveBeenCalled();
  });

  it("uses hourly token buckets across the matched extent for current, peak, and expiry", async () => {
    installWindowSeries();

    renderCard(<SubscriptionWindow />);

    await screen.findByLabelText("5h window: 150 tokens");
    expect(screen.getByTestId("5h-resets-in")).toHaveTextContent("Resets in 1h 0m");
    expect(screen.getAllByText("vs historical peak: 500 tokens")).toHaveLength(2);
    expect(postMetricsMock).toHaveBeenCalledTimes(4);
    for (const [rawQuery] of postMetricsMock.mock.calls) {
      const query = rawQuery as SeriesMetricsQuery;
      expect(query.dimensions).toEqual(["time"]);
      expect(query.grain).toBe("hour");
      expect(query.range).toEqual(WINDOW_EXTENT.meta.matchedExtent);
    }
  });

  it("sends the true, unrounded extent to the server — flooring is cache-key-only (#P4-20 review follow-up)", async () => {
    installWindowSeries();
    // A `to` that deliberately doesn't land on a minute boundary. Regression
    // guard: the real request must carry this exact value. If it regresses
    // to sending the floored (cache-key) value instead, live usage figures
    // silently undercount for up to 59s after every minute boundary, since
    // the engine filters calls strictly against `range.to`
    // (server/metrics/engine.ts's `ts > rangeToMs` check).
    listSessionsMock.mockResolvedValue({
      ...WINDOW_EXTENT,
      meta: {
        ...WINDOW_EXTENT.meta,
        matchedExtent: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-10T12:00:45.000Z" },
      },
    });

    renderCard(<SubscriptionWindow />);

    await screen.findByLabelText("5h window: 150 tokens");
    expect(postMetricsMock).toHaveBeenCalledTimes(4);
    for (const [rawQuery] of postMetricsMock.mock.calls) {
      const query = rawQuery as SeriesMetricsQuery;
      expect(query.range.to).toBe("2026-07-10T12:00:45.000Z");
    }
  });

  it("keeps the configured ceiling as the ARIA maximum and clamps only the range value", async () => {
    installWindowSeries();

    renderCard(<SubscriptionWindow ceiling={100} />);

    const progress = await screen.findByRole("progressbar", {
      name: "5h window usage: 150 tokens of Settings ceiling 100 tokens",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
    expect(progress).toHaveAttribute("aria-valuemax", "100");
    expect(progress).toHaveAttribute("aria-valuetext", "150 tokens of settings ceiling 100 tokens");
    expect(screen.getAllByText("vs settings ceiling: 100 tokens")).toHaveLength(2);
  });

  it("represents a real zero denominator without inventing a peak", async () => {
    listSessionsMock.mockResolvedValue(NON_NULL_EXTENT);
    postMetricsMock.mockResolvedValue(EMPTY_SERIES);

    renderCard(<SubscriptionWindow />);

    const progress = await screen.findByRole("progressbar", {
      name: "5h window usage: 0 tokens of historical peak 0 tokens",
    });
    expect(progress).toHaveAttribute("aria-valuenow", "0");
    expect(progress).toHaveAttribute("aria-valuemax", "0");
  });
});
