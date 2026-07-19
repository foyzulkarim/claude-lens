// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { CacheLabAnalysis } from "../../../../shared/cache-lab-contract.js";

// T4 harness — single hook + single consumer so we can pin the
// fetch/hook contract without depending on the panel components that
// land in T6/T7. T6+ extends this file with panel assertions.

const postCacheLabMock = vi.fn<(query: unknown) => Promise<CacheLabAnalysis>>();
vi.mock("../../api/cacheLab.js", () => ({
  postCacheLab: (query: unknown) => postCacheLabMock(query),
}));

// jsdom has no ResizeObserver and no canvas backing — stub the leaf
// Chart like Dashboard.test.tsx does.
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: { option: { series?: unknown[] }; className?: string; ariaLabel?: string }) => (
    <div
      data-testid="chart-stub"
      data-aria-label={props.ariaLabel ?? ""}
      className={props.className}
    />
  ),
}));

const { useCacheLabAnalysis } = await import("./useCacheLabAnalysis.js");
const { FleetOverview } = await import("./FleetOverview.js");
const { BustEconomicsPanel } = await import("./BustEconomicsPanel.js");
const { MissAttributionPanel } = await import("./MissAttributionPanel.js");
const { TtlMixPanel } = await import("./TtlMixPanel.js");
const { HitRatePanel } = await import("./HitRatePanel.js");
const { BaselineWeightPanel } = await import("./BaselineWeightPanel.js");
const { InvalidationCostPanel } = await import("./InvalidationCostPanel.js");
const { InvalidationGallery } = await import("./InvalidationGallery.js");
const { ContextGrowthPanel } = await import("./ContextGrowthPanel.js");
const { CacheLab } = await import("../CacheLab.js");
const { buildHitRateOption, buildBaselineWeightOption, buildInvalidationCostOption } = await import(
  "./chart-options.js"
);

function emptyAnalysis(): CacheLabAnalysis {
  return {
    economics: {
      actualCost: 0,
      cacheSavings: 0,
      uncachedCost: 0,
      bustLoss: 0,
      netBenefit: 0,
      bustCount: 0,
      netNegativeSessionCount: 0,
      pricingComplete: true,
    },
    attribution: {
      ttlLapseCount: 0,
      prefixChangeCount: 0,
      unknownCount: 0,
      verdict: "no-events",
    },
    ttlMix: { ephemeral5mTokens: 0, ephemeral1hTokens: 0, unknownTokens: 0 },
    baseline: { grain: "day", points: [] },
    invalidationCost: { grain: "day", points: [] },
    gallery: { items: [], total: 0, truncated: false },
    contextGrowth: { curves: [], total: 0, truncated: false, basis: "token-estimated" },
  };
}

function populatedAnalysis(): CacheLabAnalysis {
  return {
    economics: {
      actualCost: 1.0,
      cacheSavings: 0.45,
      uncachedCost: 1.45,
      bustLoss: 0.07,
      netBenefit: 0.38,
      bustCount: 1,
      netNegativeSessionCount: 1,
      pricingComplete: true,
    },
    attribution: {
      ttlLapseCount: 2,
      prefixChangeCount: 3,
      unknownCount: 1,
      verdict: "mixed",
    },
    ttlMix: { ephemeral5mTokens: 60_000, ephemeral1hTokens: 30_000, unknownTokens: 10_000 },
    baseline: { grain: "day", points: [] },
    invalidationCost: { grain: "day", points: [] },
    gallery: { items: [], total: 0, truncated: false },
    contextGrowth: { curves: [], total: 0, truncated: false, basis: "token-estimated" },
  };
}

const FIXED_NOW = new Date(2026, 6, 18, 12, 0, 0); // local 2026-07-18 noon

function Harness({
  filters,
  grain,
}: {
  filters: import("../../filters/state.js").FilterState;
  grain: import("../../../../shared/metrics-contract.js").Grain;
}) {
  const query = useCacheLabAnalysis(filters, grain, FIXED_NOW);
  if (query.isPending) return <div data-testid="pending">loading</div>;
  if (query.isError) return <div data-testid="error">{query.error.message}</div>;
  return <div data-testid="ok">{query.data.attribution.verdict}</div>;
}

function renderHarness(
  filters: import("../../filters/state.js").FilterState,
  grain: import("../../../../shared/metrics-contract.js").Grain,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/cache", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Harness filters={filters} grain={grain} />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

const baseFilters: import("../../filters/state.js").FilterState = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
  project: [],
  model: [],
  branch: [],
  host: [],
};

beforeEach(() => {
  postCacheLabMock.mockReset();
  postCacheLabMock.mockResolvedValue(emptyAnalysis());
});

afterEach(() => {
  cleanup();
});

describe("useCacheLabAnalysis — hook contract (T4)", () => {
  it("posts a query derived from URL filters + grain", async () => {
    renderHarness(baseFilters, "day");
    await waitFor(() => {
      expect(postCacheLabMock).toHaveBeenCalled();
    });
    const [queryArg] = postCacheLabMock.mock.calls[0] as [
      { range: { from: string; to: string }; grain: string },
    ];
    expect(queryArg.range.from).toBe("2026-07-01T00:00:00.000Z");
    expect(queryArg.range.to).toBe("2026-07-18T00:00:00.000Z");
    expect(queryArg.grain).toBe("day");
  });

  it("deduplicates across mounted hook consumers with identical inputs", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook, searchHook } = memoryLocation({ path: "/cache", static: true });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Harness filters={baseFilters} grain="day" />
          <Harness filters={baseFilters} grain="day" />
        </Router>
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    await waitFor(() => expect(postCacheLabMock).toHaveBeenCalledTimes(1));
  });

  it("produces a distinct query key when grain changes", async () => {
    renderHarness(baseFilters, "day");
    await waitFor(() => expect(postCacheLabMock).toHaveBeenCalledTimes(1));
    cleanup();
    renderHarness(baseFilters, "week");
    await waitFor(() => expect(postCacheLabMock).toHaveBeenCalledTimes(2));
    const calls = postCacheLabMock.mock.calls as Array<[{ grain: string }]>;
    expect(calls[0]?.[0]?.grain).toBe("day");
    expect(calls[1]?.[0]?.grain).toBe("week");
  });

  it("renders error state when the API rejects", async () => {
    postCacheLabMock.mockRejectedValueOnce(new Error("boom"));
    renderHarness(baseFilters, "day");
    await waitFor(() => {
      expect(document.querySelector('[data-testid="error"]')).not.toBeNull();
    });
  });
});

describe("T6 panels — populated overview + diagnostics", () => {
  function renderWith(data: CacheLabAnalysis | undefined) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <FleetOverview hitRateSeries={[]} cacheLab={data} />
        <BustEconomicsPanel data={data} />
        <MissAttributionPanel data={data} />
        <TtlMixPanel data={data} />
      </QueryClientProvider>
    ) as ReactElement;
    return render(tree);
  }

  it("renders the four overview cards + the diagnostic panels from populated data", () => {
    renderWith(populatedAnalysis());
    // Overview
    expect(screen.getByText(/fleet cache overview/i)).toBeInTheDocument();
    expect(screen.getByText("cache hit %")).toBeInTheDocument();
    expect(screen.getByText("tokens saved")).toBeInTheDocument();
    expect(screen.getByText("busted events")).toBeInTheDocument();
    expect(screen.getByText("median baseline")).toBeInTheDocument();
    // Diagnostics
    expect(screen.getByText(/cache busts vs savings/i)).toBeInTheDocument();
    expect(screen.getByText(/miss attribution/i)).toBeInTheDocument();
    expect(screen.getByText(/ttl mix/i)).toBeInTheDocument();
    // Numbers from populated analysis
    expect(screen.getByTestId("miss-attribution-ttl")).toHaveTextContent("2");
    expect(screen.getByTestId("miss-attribution-prefix")).toHaveTextContent("3");
    expect(screen.getByTestId("miss-attribution-unknown")).toHaveTextContent("1");
    expect(screen.getByTestId("miss-attribution-verdict")).toHaveTextContent(/mixed/i);
    expect(screen.getByTestId("bust-economics-negative-sessions")).toHaveTextContent(
      /1 session net negative/i,
    );
  });

  it("renders the empty / loading skeletons honestly", () => {
    renderWith(undefined);
    // Loading skeletons — overview cards show "—" when no data, and the
    // diagnostic panels show "Loading…".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThanOrEqual(2);
  });

  it("renders 0 values as 0 / $0, never as missing", () => {
    renderWith(emptyAnalysis());
    expect(screen.getByTestId("miss-attribution-ttl")).toHaveTextContent("0");
    expect(screen.getByTestId("miss-attribution-prefix")).toHaveTextContent("0");
    expect(screen.getByTestId("miss-attribution-verdict")).toHaveTextContent(/no invalidations/i);
    expect(screen.getByTestId("bust-economics-net")).toBeInTheDocument();
  });

  it("TTL mix segments reconcile to total cache creation tokens", () => {
    renderWith(populatedAnalysis());
    // 60k + 30k + 10k = 100k total
    // 5m = 60%, 1h = 30%, unknown = 10%
    expect(screen.getByText(/60,000 \(60%\)/)).toBeInTheDocument();
    expect(screen.getByText(/30,000 \(30%\)/)).toBeInTheDocument();
    expect(screen.getByText(/10,000 \(10%\)/)).toBeInTheDocument();
  });

  it("surfaces the unpriced state for tokens-saved when pricing is incomplete", () => {
    renderWith({
      ...populatedAnalysis(),
      economics: { ...populatedAnalysis().economics, pricingComplete: false, cacheSavings: null },
    });
    expect(screen.getByText(/unpriced/i)).toBeInTheDocument();
    expect(screen.getByText(/pricing incomplete/i)).toBeInTheDocument();
  });

  it("renders net-negative badge when netNegativeSessionCount > 0", () => {
    renderWith(populatedAnalysis());
    expect(screen.getByTestId("bust-economics-negative-sessions")).toBeInTheDocument();
  });
});

describe("T7 panels — chart-options helpers", () => {
  // Pure, finite-data guards so a future migration can't let NaN/Infinity
  // reach ECharts.

  it("strips non-finite values from hit-rate series", () => {
    const option = buildHitRateOption([
      { t: "2026-07-01T00:00:00.000Z", hitRate: 0.5 },
      { t: "2026-07-02T00:00:00.000Z", hitRate: Number.NaN },
      { t: "2026-07-03T00:00:00.000Z", hitRate: Number.POSITIVE_INFINITY },
      { t: "2026-07-04T00:00:00.000Z", hitRate: 0.7 },
    ]);
    const series = option.series as { data: [string, number | null][] }[];
    const data = series[0]?.data;
    expect(data[0]?.[1]).toBe(0.5);
    expect(data[1]?.[1]).toBeNull();
    expect(data[2]?.[1]).toBeNull();
    expect(data[3]?.[1]).toBe(0.7);
  });

  it("baseline weight option renders null medianTokens as null, not as 0", () => {
    const option = buildBaselineWeightOption([
      { t: "2026-07-01T00:00:00.000Z", medianTokens: 12000, sampleCount: 1 },
      { t: "2026-07-02T00:00:00.000Z", medianTokens: null, sampleCount: 0 },
    ]);
    const series = option.series as { data: [string, number | null][] }[];
    expect(series[0]?.data[0]?.[1]).toBe(12000);
    expect(series[0]?.data[1]?.[1]).toBeNull();
  });

  it("invalidation cost option stacks 3 causes and propagates per-cause nulls", () => {
    const option = buildInvalidationCostOption([
      { t: "2026-07-01T00:00:00.000Z", modelSwitch: 5, compaction: null, unexplained: 2 },
      { t: "2026-07-02T00:00:00.000Z", modelSwitch: null, compaction: 3, unexplained: 0 },
    ]);
    const series = option.series as {
      name: string;
      stack: string;
      data: [string, number | null][];
    }[];
    expect(series).toHaveLength(3);
    expect(series.every((s) => s.stack === "cost")).toBe(true);
    expect(series[0]?.data[0]?.[1]).toBe(5);
    expect(series[1]?.data[0]?.[1]).toBeNull();
    expect(series[2]?.data[0]?.[1]).toBe(2);
  });
});

describe("T7 panels — chart component rendering", () => {
  function renderCharts(data: CacheLabAnalysis) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook, searchHook } = memoryLocation({ path: "/cache", static: true });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <HitRatePanel series={[]} />
          <BaselineWeightPanel points={data.baseline.points} />
          <InvalidationCostPanel points={data.invalidationCost.points} />
        </Router>
      </QueryClientProvider>
    ) as ReactElement;
    return render(tree);
  }

  it("renders all three chart panels with their headings", () => {
    const data = populatedAnalysis();
    renderCharts(data);
    expect(screen.getByText(/hit rate/i)).toBeInTheDocument();
    expect(screen.getByText(/baseline weight/i)).toBeInTheDocument();
    expect(screen.getByText(/invalidation cost by cause/i)).toBeInTheDocument();
  });
});

describe("T8 panels — gallery + context growth", () => {
  it("renders gallery empty state when no events", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const data = { ...emptyAnalysis(), gallery: { items: [], total: 0, truncated: false } };
    const tree = (
      <QueryClientProvider client={queryClient}>
        <InvalidationGallery data={data} />
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    expect(screen.getByText(/no invalidation events in range/i)).toBeInTheDocument();
  });

  it("renders gallery items with cause + attribution + turn link", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const data = {
      ...emptyAnalysis(),
      gallery: {
        items: [
          {
            sessionId: "s1",
            callId: "c1",
            messageId: "m1",
            promptId: "p1",
            turnIndex: 0,
            streamKey: "main",
            timestamp: "2026-07-10T10:00:00.000Z",
            model: "claude-sonnet-5",
            cacheCreateTokens: 15_000,
            baseCause: "model-switch" as const,
            attribution: "ttl-lapse" as const,
            bustLossComputed: 0.09,
          },
          {
            sessionId: "s2",
            callId: "c2",
            messageId: "m2",
            promptId: undefined,
            streamKey: "agent-x",
            timestamp: "2026-07-11T11:00:00.000Z",
            model: "claude-fable-5",
            cacheCreateTokens: 22_000,
            baseCause: "unexplained" as const,
            attribution: "unknown" as const,
            bustLossComputed: null,
          },
        ],
        total: 2,
        truncated: false,
      },
    };
    const tree = (
      <QueryClientProvider client={queryClient}>
        <InvalidationGallery data={data} />
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    // Truncation disclosure: not truncated, 2 events
    expect(screen.getByText(/2 events/i)).toBeInTheDocument();
    // Each cause label
    expect(screen.getByText("model-switch")).toBeInTheDocument();
    expect(screen.getByText("unexplained")).toBeInTheDocument();
    // Attribution labels
    expect(screen.getByText("TTL lapse")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    // Tokens + cost
    expect(screen.getByText(/15,000 tok/)).toBeInTheDocument();
    // Bust loss formatted
    expect(screen.getByText(/\$0\.09/)).toBeInTheDocument();
    // Items with promptId link; items without show fallback text
    expect(screen.getByText(/view turn/i)).toBeInTheDocument();
    expect(screen.getByText(/no turn attribution/i)).toBeInTheDocument();
  });

  it("renders context-growth with truncated disclosure when more sessions exist than 24", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const curves = Array.from({ length: 24 }, (_, i) => ({
      sessionId: `s${i}`,
      points: [
        { turnIndex: 0, timestamp: "2026-07-10T10:00:00.000Z", inputTokens: 1000 * (i + 1) },
        { turnIndex: 1, timestamp: "2026-07-10T10:05:00.000Z", inputTokens: 2000 * (i + 1) },
      ],
    }));
    const data = { curves, total: 30, truncated: true, basis: "token-estimated" as const };
    const tree = (
      <QueryClientProvider client={queryClient}>
        <ContextGrowthPanel data={data} />
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    expect(screen.getByText(/showing 24 of 30/i)).toBeInTheDocument();
    expect(screen.getByText(/token-estimated/i)).toBeInTheDocument();
  });

  it("renders context-growth with no-evidence empty state when 0 curves", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <ContextGrowthPanel
          data={{ curves: [], total: 0, truncated: false, basis: "token-estimated" }}
        />
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    expect(screen.getByText(/no context curves in range/i)).toBeInTheDocument();
  });
});

describe("T8 — CacheLab page shell composition", () => {
  it("renders the page heading and the 4 overview cards", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook, searchHook } = memoryLocation({ path: "/cache", static: true });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <CacheLab />
        </Router>
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    expect(screen.getByText(/^Cache Lab$/)).toBeInTheDocument();
    // Loading skeletons show "—" or "Loading…"
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders page and section alerts when the Cache Lab endpoint fails (failure isolation)", async () => {
    postCacheLabMock.mockRejectedValue(new Error("boom"));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { hook, searchHook } = memoryLocation({ path: "/cache", static: true });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <CacheLab />
        </Router>
      </QueryClientProvider>
    ) as ReactElement;
    render(tree);
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(8));
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/cache lab analysis failed/i);
  });
});
