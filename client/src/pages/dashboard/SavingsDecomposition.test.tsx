// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { SavingsDecomposition, computeSavingsTotals } = await import("./SavingsDecomposition.js");

function renderSection(search = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const searchPath = search.startsWith("?") ? search.slice(1) : search;
  const { hook, searchHook } = memoryLocation({ path: "/", searchPath, record: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <SavingsDecomposition />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  postMetricsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

// Hand-priced fixture: two model groups, each pricing out to a known
// (cache, routing) pair. Per the T3a algebra (measures.ts):
//   cacheSavings   = uncachedAtCurrentModel - actual
//   routingSavings = opusUncached - currentUncached   (the "model mix" savings)
//   cacheSavings + routingSavings = opusUncached - actual  (single, shared
//     counterfactual — no double counting, decision A8)
//
// So the hand-computed "opus-uncached minus actual" total below is exactly
// what cache+routing must sum to, independent of how the split fell. The
// individual `cache` and `routing` values below are picked to satisfy this
// invariant (cache + routing = opusUncachedMinusActual per group); the
// component-level "uncached vs actual" split is irrelevant — only the sum
// is observable in the UI, and the test asserts only the sum.
const modelA = { cache: 300, routing: 30, opusUncachedMinusActual: 330 };
const modelB = { cache: 112, routing: 19, opusUncachedMinusActual: 131 };

const populatedSeries: Series[] = [
  {
    measure: "cacheSavingsComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: modelA.cache }],
  },
  {
    measure: "cacheSavingsComputed",
    dimensionKey: "model:claude-fable-5",
    label: "claude-fable-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: modelB.cache }],
  },
  {
    measure: "routingSavingsComputed",
    dimensionKey: "model:claude-sonnet-5",
    label: "claude-sonnet-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: modelA.routing }],
  },
  {
    measure: "routingSavingsComputed",
    dimensionKey: "model:claude-fable-5",
    label: "claude-fable-5",
    points: [{ t: "2026-07-08T00:00:00.000Z", value: modelB.routing }],
  },
];

describe("computeSavingsTotals — sum-of-savings invariant", () => {
  it("returns undefined while loading (no fabricated zero)", () => {
    expect(computeSavingsTotals(undefined)).toBeUndefined();
  });

  it("sums cache + routing to exactly the all-Opus-uncached counterfactual, within float tolerance", () => {
    const totals = computeSavingsTotals(populatedSeries);
    expect(totals).toBeDefined();
    const expectedTotal = modelA.opusUncachedMinusActual + modelB.opusUncachedMinusActual;
    expect(totals?.cache).toBeCloseTo(modelA.cache + modelB.cache, 6);
    expect(totals?.routing).toBeCloseTo(modelA.routing + modelB.routing, 6);
    // The invariant this task exists to protect: cache + routing must equal
    // the single shared counterfactual, with no double-counting.
    expect(totals?.total).toBeCloseTo(expectedTotal, 6);
  });

  it("drops an unpriced model's null contribution from both segments instead of fabricating a value", () => {
    const withUnpriced: Series[] = [
      ...populatedSeries,
      {
        measure: "cacheSavingsComputed",
        dimensionKey: "model:some-unpriced-model",
        label: "some-unpriced-model",
        points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
      },
      {
        measure: "routingSavingsComputed",
        dimensionKey: "model:some-unpriced-model",
        label: "some-unpriced-model",
        points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
      },
    ];
    const totals = computeSavingsTotals(withUnpriced);
    // Consistent with only the priced calls (modelA + modelB) — the unpriced
    // group contributes nothing, not NaN and not a fabricated positive share.
    expect(totals?.cache).toBeCloseTo(modelA.cache + modelB.cache, 6);
    expect(totals?.routing).toBeCloseTo(modelA.routing + modelB.routing, 6);
    expect(totals?.total).toBeGreaterThanOrEqual(0);
  });

  it("treats an empty resolved series list as a real zero, not undefined", () => {
    expect(computeSavingsTotals([])).toEqual({ cache: 0, routing: 0, total: 0 });
  });

  it("ignores non-finite point values defensively, same convention as ChartCard", () => {
    const withNonFinite: Series[] = [
      {
        measure: "cacheSavingsComputed",
        dimensionKey: "model:x",
        label: "x",
        points: [{ t: "2026-07-08T00:00:00.000Z", value: Number.NaN }],
      },
      {
        measure: "routingSavingsComputed",
        dimensionKey: "model:x",
        label: "x",
        points: [{ t: "2026-07-08T00:00:00.000Z", value: Number.POSITIVE_INFINITY }],
      },
    ];
    expect(computeSavingsTotals(withNonFinite)).toEqual({ cache: 0, routing: 0, total: 0 });
  });
});

describe("SavingsDecomposition — render states", () => {
  it("renders a loading state before postMetrics resolves", () => {
    postMetricsMock.mockImplementation(() => new Promise(() => {}));
    renderSection();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("renders an error state when postMetrics rejects", async () => {
    postMetricsMock.mockRejectedValue(new Error("boom"));
    renderSection();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"));
  });

  it("shows two labeled stacked segments summing to the expected total once resolved", async () => {
    postMetricsMock.mockResolvedValue(populatedSeries);
    renderSection();
    await waitFor(() => expect(screen.getByText("cache discount")).toBeInTheDocument());
    expect(screen.getByText("cheap-model routing")).toBeInTheDocument();
    expect(screen.getByText("$412.00")).toBeInTheDocument(); // cache: 300 + 112
    expect(screen.getByText("$49.00")).toBeInTheDocument(); // routing: 30 + 19
    expect(screen.getByTestId("savings-total")).toHaveTextContent("$461.00 total");
  });

  it("renders a real $0.00 for zero savings instead of fabricating an optimistic number", async () => {
    postMetricsMock.mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(screen.getByTestId("savings-total")).toHaveTextContent("$0.00"));
    const zeros = screen.getAllByText("$0.00");
    expect(zeros.length).toBeGreaterThanOrEqual(2);
  });

  it("drops an unpriced model's share from the rendered totals", async () => {
    postMetricsMock.mockResolvedValue([
      ...populatedSeries,
      {
        measure: "cacheSavingsComputed",
        dimensionKey: "model:some-unpriced-model",
        label: "some-unpriced-model",
        points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
      },
      {
        measure: "routingSavingsComputed",
        dimensionKey: "model:some-unpriced-model",
        label: "some-unpriced-model",
        points: [{ t: "2026-07-08T00:00:00.000Z", value: null }],
      },
    ]);
    renderSection();
    await waitFor(() => expect(screen.getByTestId("savings-total")).toHaveTextContent("$461.00"));
  });

  it("sends a model-broken-down query so an unpriced model's group can be dropped independently", async () => {
    postMetricsMock.mockResolvedValue(populatedSeries);
    renderSection();
    await waitFor(() => expect(postMetricsMock).toHaveBeenCalledTimes(1));
    const sentQuery = postMetricsMock.mock.calls[0]?.[0] as {
      measures: string[];
      dimensions: string[];
    };
    expect(sentQuery.measures).toEqual(["cacheSavingsComputed", "routingSavingsComputed"]);
    expect(sentQuery.dimensions).toEqual(["model"]);
  });
});
