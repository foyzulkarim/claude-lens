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

const { FailedWorkStat, failedWorkCount, formatFailedWorkCount } = await import(
  "./FailedWorkStat.js"
);

function toolErrorsSeries(value: number | null): Series[] {
  return [
    {
      measure: "toolErrors",
      dimensionKey: "all",
      label: "All",
      points: [{ t: "2026-07-08T00:00:00.000Z", value }],
    },
  ];
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <FailedWorkStat />
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

describe("failedWorkCount / formatFailedWorkCount — pure helpers (Testable Seam)", () => {
  it("distinguishes a real zero from an unavailable (null) measure", () => {
    expect(failedWorkCount(toolErrorsSeries(0))).toBe(0);
    expect(failedWorkCount(toolErrorsSeries(null))).toBeNull();
    expect(failedWorkCount(undefined)).toBeNull();
  });

  it("renders 0 as the string '0', and null as '—' — never coalescing one into the other", () => {
    expect(formatFailedWorkCount(0)).toBe("0");
    expect(formatFailedWorkCount(null)).toBe("—");
  });

  it("renders a positive count verbatim", () => {
    expect(failedWorkCount(toolErrorsSeries(7))).toBe(7);
    expect(formatFailedWorkCount(7)).toBe("7");
  });
});

describe("FailedWorkStat component", () => {
  it("renders 0 (a real zero) distinctly from — (unavailable)", async () => {
    postMetricsMock.mockResolvedValue(toolErrorsSeries(0));
    renderCard();
    await waitFor(() => expect(screen.getByText("0")).toBeInTheDocument());
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("renders — when the toolErrors measure is unavailable (null, not 0)", async () => {
    postMetricsMock.mockResolvedValue(toolErrorsSeries(null));
    renderCard();
    await waitFor(() => expect(screen.getByText("—")).toBeInTheDocument());
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders a positive failure count", async () => {
    postMetricsMock.mockResolvedValue(toolErrorsSeries(12));
    renderCard();
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
  });
});
