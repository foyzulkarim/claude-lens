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

const { LeverageRatio, computeLeverageRatio, formatLeverageRatio } = await import(
  "./LeverageRatio.js"
);

function aggregateSeries(values: {
  cacheReadTokens: number | null;
  inputTokens: number | null;
  cacheCreateTokens: number | null;
}): Series[] {
  const t = "2026-07-08T00:00:00.000Z";
  return [
    {
      measure: "cacheReadTokens",
      dimensionKey: "all",
      label: "All",
      points: [{ t, value: values.cacheReadTokens }],
    },
    {
      measure: "inputTokens",
      dimensionKey: "all",
      label: "All",
      points: [{ t, value: values.inputTokens }],
    },
    {
      measure: "cacheCreateTokens",
      dimensionKey: "all",
      label: "All",
      points: [{ t, value: values.cacheCreateTokens }],
    },
  ];
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <LeverageRatio />
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

describe("computeLeverageRatio — pure arithmetic (Testable Seam)", () => {
  it("divides cache-read tokens by fresh-billed (input + cache-create) tokens", () => {
    expect(computeLeverageRatio(2_060_000, 80_000, 20_000)).toBeCloseTo(20.6, 5);
  });

  it("returns null (not Infinity) when the denominator is exactly zero", () => {
    expect(computeLeverageRatio(0, 0, 0)).toBeNull();
    expect(computeLeverageRatio(100, 0, 0)).toBeNull();
  });

  it("returns null (not NaN) when any operand is unavailable", () => {
    expect(computeLeverageRatio(null, 80_000, 20_000)).toBeNull();
    expect(computeLeverageRatio(2_060_000, null, 20_000)).toBeNull();
    expect(computeLeverageRatio(2_060_000, 80_000, null)).toBeNull();
  });
});

describe("formatLeverageRatio", () => {
  it("formats as Nx with one decimal place", () => {
    expect(formatLeverageRatio(20.55)).toBe("20.6×");
  });

  it("renders unavailable, not NaN/Infinity", () => {
    expect(formatLeverageRatio(null)).toBe("—");
  });
});

describe("LeverageRatio component", () => {
  it("renders the Nx headline once data resolves", async () => {
    postMetricsMock.mockResolvedValue(
      aggregateSeries({
        cacheReadTokens: 2_060_000,
        inputTokens: 80_000,
        cacheCreateTokens: 20_000,
      }),
    );
    renderCard();
    await waitFor(() => expect(screen.getByText("20.6×")).toBeInTheDocument());
  });

  it("renders unavailable (not NaN/Infinity) on a zero denominator", async () => {
    postMetricsMock.mockResolvedValue(
      aggregateSeries({ cacheReadTokens: 0, inputTokens: 0, cacheCreateTokens: 0 }),
    );
    renderCard();
    await waitFor(() => expect(screen.getByText("—")).toBeInTheDocument());
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });
});
