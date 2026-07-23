// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { HealthSnapshot } from "../../../../shared/health-contract.js";

const fetchHealthMock = vi.fn<() => Promise<HealthSnapshot>>();
vi.mock("../../api/health.js", () => ({
  fetchHealth: () => fetchHealthMock(),
}));

const { DataHealth } = await import("./DataHealth.js");

function emptySnapshot(): HealthSnapshot {
  return {
    files: [],
    totalMalformedLines: 0,
    observedFileCount: 0,
    observedSince: Date.now(),
    dedup: { rawLines: 0, distinctCalls: 0, duplicates: 0 },
    parseErrors: { malformedLines: 0, byFile: [] },
    scan: {
      roots: [],
      transcriptsFound: 0,
      transcriptsParsed: 0,
      transcriptsFailed: 0,
      sessionsWithSidecars: 0,
    },
    pricingCoverage: { modelsSeen: [], unpricedModels: [] },
    sidecarCoverage: { total: 0, withCost: 0, withBoundaries: 0 },
    reconciliation: {
      sessionsWithObserved: 0,
      sessionsWithComputedOnly: 0,
      costComputed: 0,
      costObserved: 0,
      costLogTotal: undefined,
    },
    captureGaps: { sessionsWithoutObserved: 0 },
  };
}

function populatedSnapshot(): HealthSnapshot {
  return {
    files: [],
    totalMalformedLines: 0,
    observedFileCount: 0,
    observedSince: Date.now(),
    dedup: { rawLines: 1240, distinctCalls: 905, duplicates: 335 },
    parseErrors: { malformedLines: 2, byFile: [] },
    scan: {
      roots: [{ path: "/Users/demo/.claude/projects" }],
      transcriptsFound: 21,
      transcriptsParsed: 21,
      transcriptsFailed: 0,
      sessionsWithSidecars: 5,
    },
    pricingCoverage: {
      modelsSeen: ["claude-fable-5", "fable-5"],
      unpricedModels: ["fable-5"],
    },
    sidecarCoverage: { total: 21, withCost: 5, withBoundaries: 5 },
    reconciliation: {
      sessionsWithObserved: 5,
      sessionsWithComputedOnly: 16,
      costComputed: 12.34,
      costObserved: 13.5,
      costLogTotal: 12.99,
    },
    captureGaps: { sessionsWithoutObserved: 16 },
  };
}

function withProviders(node: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={memoryLocation().hook}>{node}</Router>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DataHealth page", () => {
  it("renders the four spec sections against an injected snapshot", () => {
    render(withProviders(<DataHealth snapshot={populatedSnapshot()} />));

    // §1 dedup
    expect(screen.getByText("Raw lines")).toBeInTheDocument();
    expect(screen.getByText("1.2k")).toBeInTheDocument();
    // §1 pricing
    expect(screen.getByText("fable-5")).toBeInTheDocument();
    expect(screen.getByText("unpriced")).toBeInTheDocument();
    // §2 scan — at least one "21" rendered (Found, Parsed, sidecar total)
    expect(screen.getAllByText("21").length).toBeGreaterThan(0);
    // §3 reconciliation — real-data path (sessionsWithObserved > 0)
    expect(screen.getByText("Cost computed")).toBeInTheDocument();
    expect(screen.getByText("$12.34")).toBeInTheDocument();
    // §4 capture gaps + boundary mismatches (locked card)
    expect(screen.getByText(/without capture/i)).toBeInTheDocument();
    expect(screen.getByText(/boundary \/ promptid mismatches/i)).toBeInTheDocument();
  });

  it("renders the locked reconciliation card when no premium data exists", () => {
    render(withProviders(<DataHealth snapshot={emptySnapshot()} />));
    expect(screen.getByText(/no premium capture observed/i)).toBeInTheDocument();
    // The §4 capture-gaps panel should show "0" with "of 0" inline —
    // both the captured and without-capture numbers are zero on an
    // empty fleet. The text is split across `<span>` siblings in the
    // JSX (value div + inline "of N" span), so we normalize the
    // section's `textContent` and assert the "0 of 0" substring is
    // present. This is robust to the DOM shape without depending on
    // the exact rendering of whitespace between text nodes.
    const captureGapsTitle = screen.getByText("Capture gaps");
    const captureGaps = captureGapsTitle.closest("section");
    expect(captureGaps).not.toBeNull();
    if (captureGaps) {
      const text = (captureGaps.textContent ?? "").replace(/\s+/g, " ");
      // The JSX renders `<div>0</div><span> of 0</span>` for the
      // captured value, so textContent is "Captured0of 0…" (no space
      // between the value div and the inline "of N" span). Assert
      // the literal "0of 0" rather than the formatted "0 of 0" so
      // the test doesn't depend on JSX whitespace choices.
      expect(text).toContain("0of 0");
    }
  });

  it("renders the loading state when the query is pending", () => {
    fetchHealthMock.mockImplementation(() => new Promise(() => {}));
    render(withProviders(<DataHealth />));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
