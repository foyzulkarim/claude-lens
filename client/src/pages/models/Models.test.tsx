// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Series } from "../../../../shared/metrics-contract.js";

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

// jsdom has no ResizeObserver/canvas — stub the leaf Chart like
// CacheLab.test.tsx does.
vi.mock("../../charts/Chart.js", () => ({
  Chart: (props: { option: { series?: unknown[] }; className?: string; ariaLabel?: string }) => (
    <div
      data-testid="chart-stub"
      data-aria-label={props.ariaLabel ?? ""}
      className={props.className}
    />
  ),
}));

const { Models } = await import("./Models.js");

function emptySeries(): Series[] {
  return [];
}

function populatedSeries(): Series[] {
  // Per-model rows for each query family the page composes. The
  // exact composition doesn't matter for the smoke-level test —
  // just that each panel renders something instead of skeleton.
  const base = { points: [{ t: "2026-07-01T00:00:00.000Z", value: 1 }] };
  const series: Series[] = [
    {
      measure: "costComputed",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      ...base,
    },
    { measure: "sessions", dimensionKey: "model:claude-fable-5", label: "claude-fable-5", ...base },
    {
      measure: "inputTokens",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      ...base,
    },
    {
      measure: "outputTokens",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      ...base,
    },
    {
      measure: "cacheReadTokens",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      ...base,
    },
    {
      measure: "cacheCreateTokens",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      ...base,
    },
    {
      measure: "costComputed",
      dimensionKey: "model:claude-fable-5",
      label: "claude-fable-5",
      ...base,
    },
    { measure: "turns", dimensionKey: "model:claude-fable-5", label: "claude-fable-5", ...base },
  ];
  return series;
}

function renderAt(route = "/models") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: route, static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Models />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

afterEach(() => {
  cleanup();
  postMetricsMock.mockReset();
});

describe("Models page shell", () => {
  it("renders the page heading and every section's testid", async () => {
    postMetricsMock.mockResolvedValue(populatedSeries());
    renderAt();

    expect(screen.getByRole("heading", { name: /^Models$/, level: 1 })).toBeInTheDocument();
    // All eight spec sections render their data-testid per ARCH A11
    // contract.
    await waitFor(() => {
      expect(screen.getByTestId("model-stats-row")).toBeInTheDocument();
    });
    expect(screen.getByTestId("model-mix-over-time")).toBeInTheDocument();
    expect(screen.getByTestId("efficiency-by-model")).toBeInTheDocument();
    expect(screen.getByTestId("version-before-after")).toBeInTheDocument();
    expect(screen.getByTestId("latency-by-model")).toBeInTheDocument();
    expect(screen.getByTestId("throughput-by-model")).toBeInTheDocument();
    expect(screen.getByTestId("locked-lines-per-cost")).toBeInTheDocument();
    expect(screen.getByTestId("entrypoint-breakdown")).toBeInTheDocument();
  });

  it("renders loading skeletons while data is in flight", () => {
    postMetricsMock.mockReturnValue(new Promise(() => {}));
    renderAt();
    // Stat row shells — the loading path returns 4 skeleton cards.
    expect(screen.getAllByLabelText("Model stats")).toHaveLength(1);
    // Each non-loading panel renders the data-testid with no data to
    // resolve, so the testid is still present.
    expect(screen.getByTestId("model-stats-row")).toBeInTheDocument();
  });

  it("renders the empty state when the engine returns no series", async () => {
    postMetricsMock.mockResolvedValue(emptySeries());
    renderAt();
    await waitFor(() => {
      // Mix-over-time panel has its own empty copy.
      expect(screen.getByText(/no model mix data in this range/i)).toBeInTheDocument();
    });
  });

  it("surfaces the 🔒 locked card for $/1k-lines", async () => {
    postMetricsMock.mockResolvedValue(populatedSeries());
    renderAt();
    await waitFor(() => {
      expect(screen.getByTestId("locked-lines-per-cost")).toBeInTheDocument();
    });
    expect(screen.getByText(/linesAdded \/ linesRemoved/i)).toBeInTheDocument();
  });
});
