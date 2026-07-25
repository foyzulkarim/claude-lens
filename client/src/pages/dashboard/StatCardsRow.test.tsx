// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { Measure, Series } from "../../../../shared/metrics-contract.js";

const postMetricsMock = vi.fn<(query: unknown) => Promise<Series[]>>();
vi.mock("../../api/metrics.js", () => ({
  postMetrics: (query: unknown) => postMetricsMock(query),
}));

const { StatCardsRow } = await import("./StatCardsRow.js");

const T = "2026-07-08T00:00:00.000Z";

function aggregate(measure: Measure, value: number): Series {
  return {
    measure,
    dimensionKey: "time",
    label: "All",
    points: [{ t: T, value }],
  };
}

/** Dispatches the two batched queries StatCardsRow fires: `[costComputed,
 * sessions]` for spend/sessions/avg, and the four token measures for Total
 * tokens + Cache hit %. */
function respondWith(tokens: Partial<Record<Measure, number>>) {
  postMetricsMock.mockImplementation((query) => {
    const measures = (query as { measures: Measure[] }).measures;
    if (measures.includes("costComputed")) {
      return Promise.resolve([aggregate("costComputed", 42), aggregate("sessions", 7)]);
    }
    return Promise.resolve(measures.map((measure) => aggregate(measure, tokens[measure] ?? 0)));
  });
}

function renderRow() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <StatCardsRow />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

/** The `<a>` wrapping a given stat card — the drill link whose explicit
 * `aria-label` is the tile's entire accessible name. */
function tileLink(name: RegExp): HTMLElement {
  return screen.getByRole("link", { name });
}

beforeEach(() => {
  postMetricsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

// Issue #122: the tile's total is correct but unexplained — a reader has no
// way to know its millions are ~95% cache reads, which is exactly what made
// the (input+output-only) chart below it look broken by comparison.
describe("StatCardsRow — Total-tokens cache-read share (#122)", () => {
  it("explains the total with a whole-percent cache-read share", async () => {
    respondWith({
      inputTokens: 1_000,
      outputTokens: 4_000,
      cacheCreateTokens: 5_000,
      cacheReadTokens: 190_000,
    });
    renderRow();

    // 190_000 / 200_000 = 95%
    await waitFor(() => expect(screen.getByText("95% cache reads")).toBeInTheDocument());
  });

  it("rounds the share to a whole percent", async () => {
    respondWith({
      inputTokens: 1,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 2,
    });
    renderRow();

    // 2/3 = 66.67% → "67% cache reads", no decimals.
    await waitFor(() => expect(screen.getByText("67% cache reads")).toBeInTheDocument());
  });

  it("never rounds a partial share up to an absolute 100% or down to 0%", async () => {
    respondWith({
      inputTokens: 4,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 996,
    });
    renderRow();

    // 99.6% — reported as 99%, since "100% cache reads" on a tile explaining
    // a total reads as "nothing was fresh", which is false.
    await waitFor(() => expect(screen.getByText("99% cache reads")).toBeInTheDocument());
  });

  it("reports a genuinely total cache-read range as 100%", async () => {
    respondWith({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 1_000,
    });
    renderRow();

    await waitFor(() => expect(screen.getByText("100% cache reads")).toBeInTheDocument());
  });

  it("omits the sub-line entirely for a zero-token range — no NaN%, no 0%", async () => {
    respondWith({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    });
    renderRow();

    await waitFor(() => expect(screen.getByText("Total tokens")).toBeInTheDocument());
    expect(screen.queryByText(/cache reads/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe("StatCardsRow — accessible names", () => {
  it("folds the sub-line into the Total-tokens link's accessible name", async () => {
    respondWith({
      inputTokens: 1_000,
      outputTokens: 4_000,
      cacheCreateTokens: 5_000,
      cacheReadTokens: 190_000,
    });
    renderRow();

    // The explicit anchor label overrides descendant text, so a visible-only
    // sub-line would be invisible to screen readers.
    await waitFor(() =>
      expect(tileLink(/^Total tokens:/)).toHaveAccessibleName(
        "Total tokens: 200K — 95% cache reads — view in Models",
      ),
    );
  });

  it("leaves a tile without a sub-line at its existing accessible-name shape", async () => {
    respondWith({
      inputTokens: 1_000,
      outputTokens: 4_000,
      cacheCreateTokens: 5_000,
      cacheReadTokens: 190_000,
    });
    renderRow();

    await waitFor(() =>
      expect(tileLink(/^Spend:/)).toHaveAccessibleName("Spend: $42.00 — view in Trends"),
    );
    expect(tileLink(/^Sessions:/)).toHaveAccessibleName("Sessions: 7 — view in Sessions");
  });
});

describe("StatCardsRow — regression guards", () => {
  it("keeps Cache hit % on its own denominator, distinct from the cache-read share", async () => {
    // Cache hit % excludes output tokens: 190_000 / (1_000 + 190_000 + 5_000)
    // = 96.9%, while the cache-read share includes them: 190_000 / 200_000 =
    // 95%. The two answer different questions and must not be unified.
    respondWith({
      inputTokens: 1_000,
      outputTokens: 4_000,
      cacheCreateTokens: 5_000,
      cacheReadTokens: 190_000,
    });
    renderRow();

    await waitFor(() => expect(screen.getByText("95% cache reads")).toBeInTheDocument());
    expect(screen.getByText("96.9%")).toBeInTheDocument();
  });

  it("leaves the tile's total, drill target, and the other four cards untouched", async () => {
    respondWith({
      inputTokens: 1_000,
      outputTokens: 4_000,
      cacheCreateTokens: 5_000,
      cacheReadTokens: 190_000,
    });
    renderRow();

    await waitFor(() => expect(screen.getByText("200K")).toBeInTheDocument());
    expect(tileLink(/^Total tokens:/)).toHaveAttribute("href", "/models");
    for (const label of ["Spend", "Total tokens", "Cache hit %", "Sessions", "Avg $/session"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });
});
