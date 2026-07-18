// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionListItem, SessionListResponse } from "../../../../shared/sessions-contract.js";

const listSessionsMock = vi.fn<(params: unknown) => Promise<SessionListResponse>>();
vi.mock("../../api/sessions.js", () => ({
  listSessions: (params: unknown) => listSessionsMock(params),
}));

const {
  AnomalyFeed,
  turnSamplesFromSessions,
  anomalyItemsFromSamples,
}: typeof import("./AnomalyFeed.js") = await import("./AnomalyFeed.js");
type AnomalyFeedItem = import("./AnomalyFeed.js").AnomalyFeedItem;

function emptyResponse(): SessionListResponse {
  return {
    items: [],
    total: 0,
    meta: {
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

function renderFeed(props: { items?: AnomalyFeedItem[] } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook } = memoryLocation({ path: "/", static: true });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <AnomalyFeed {...props} />
      </Router>
    </QueryClientProvider>
  ) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue(emptyResponse());
});

afterEach(() => {
  cleanup();
});

describe("AnomalyFeed — default gate stub", () => {
  it("has the anomaly-feed testid and shows the not-available message by default", async () => {
    renderFeed();
    expect(screen.getByTestId("anomaly-feed")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText(/Gate failure and capture-gap data not available yet/),
      ).toBeInTheDocument(),
    );
  });

  it("does not render a bare empty list when there is no data", async () => {
    renderFeed();
    await waitFor(() => expect(listSessionsMock).toHaveBeenCalled());
    expect(screen.queryByRole("feed")).not.toBeInTheDocument();
  });
});

describe("AnomalyFeed — item-kind rendering branches", () => {
  it("renders an anomaly-kind item with its severity and summary", () => {
    const items: AnomalyFeedItem[] = [
      {
        kind: "anomaly",
        sessionId: "session-1",
        turnId: "turn-3",
        severity: "high",
        summary: "Turn cost $12.00 is 12.0x the session median ($1.00)",
        drill: "/sessions/session-1",
      },
    ];
    renderFeed({ items });
    expect(screen.getByText("Cost anomaly")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText(/12\.0x the session median/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View session session-1, turn-3" })).toHaveAttribute(
      "href",
      "/sessions/session-1",
    );
  });

  it("renders a gateFailure-kind item", () => {
    const items: AnomalyFeedItem[] = [
      {
        kind: "gateFailure",
        sessionId: "session-2",
        turnId: "turn-9",
        severity: "medium",
        summary: "Gate check failed on turn 9",
        drill: "/sessions/session-2",
      },
    ];
    renderFeed({ items });
    expect(screen.getByText("Gate failure")).toBeInTheDocument();
    expect(screen.getByText("Gate check failed on turn 9")).toBeInTheDocument();
  });

  it("renders a captureGap-kind item", () => {
    const items: AnomalyFeedItem[] = [
      {
        kind: "captureGap",
        sessionId: "session-3",
        severity: "low",
        summary: "Cost log missing for a window",
        drill: "/sessions/session-3",
      },
    ];
    renderFeed({ items });
    expect(screen.getByText("Capture gap")).toBeInTheDocument();
    expect(screen.getByText("Cost log missing for a window")).toBeInTheDocument();
  });

  it("with an items override, an explicitly empty list shows 'No anomalies detected' rather than the gate stub", () => {
    renderFeed({ items: [] });
    expect(screen.getByText("No anomalies detected.")).toBeInTheDocument();
    expect(screen.queryByText(/not available yet/)).not.toBeInTheDocument();
  });

  it("with mixed kinds, every item renders in a single feed list", () => {
    const items: AnomalyFeedItem[] = [
      {
        kind: "anomaly",
        sessionId: "s1",
        severity: "high",
        summary: "a",
        drill: "/sessions/s1",
      },
      {
        kind: "gateFailure",
        sessionId: "s2",
        severity: "medium",
        summary: "b",
        drill: "/sessions/s2",
      },
      {
        kind: "captureGap",
        sessionId: "s3",
        severity: "low",
        summary: "c",
        drill: "/sessions/s3",
      },
    ];
    renderFeed({ items });
    // Review #16: the container is now a plain `<ul>` (no role="feed") so
    // a 5-item static list doesn't carry an ARIA APG contract it can't fulfill.
    // Match by the descriptive aria-label instead.
    expect(screen.getByRole("list", { name: "Anomaly items" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^View session / })).toHaveLength(3);
  });
});

describe("turnSamplesFromSessions — cumulative trace → per-turn deltas", () => {
  it("diffs consecutive cumulative trace points into per-turn costComputed samples", () => {
    const sessions: SessionListItem[] = [
      {
        sessionId: "s1",
        startedAt: "t",
        lastAt: "t",
        project: "p",
        model: "m",
        durationMs: 0,
        turnCount: 3,
        costComputed: 6,
        trace: [
          { turnIndex: 0, cost: 1, timestamp: "t0" },
          { turnIndex: 1, cost: 3, timestamp: "t1" },
          { turnIndex: 2, cost: 6, timestamp: "t2" },
        ],
      },
    ];
    expect(turnSamplesFromSessions(sessions)).toEqual([
      { sessionId: "s1", turnId: "turn-0", costComputed: 1 },
      { sessionId: "s1", turnId: "turn-1", costComputed: 2 },
      { sessionId: "s1", turnId: "turn-2", costComputed: 3 },
    ]);
  });

  it("skips sessions with no trace", () => {
    const sessions: SessionListItem[] = [
      {
        sessionId: "s1",
        startedAt: "t",
        lastAt: "t",
        project: "p",
        model: "m",
        durationMs: 0,
        turnCount: 0,
        costComputed: 0,
      },
    ];
    expect(turnSamplesFromSessions(sessions)).toEqual([]);
  });
});

describe("anomalyItemsFromSamples — detector wiring", () => {
  it("uses the T3b detector's flagged output to build anomaly-kind items", () => {
    // One clear outlier: median of [1,1,1,1] = 1, outlier at 10 (10x) exceeds
    // the detector's default factor (5).
    const samples = [
      { sessionId: "s1", turnId: "turn-0", costComputed: 1 },
      { sessionId: "s1", turnId: "turn-1", costComputed: 1 },
      { sessionId: "s2", turnId: "turn-0", costComputed: 1 },
      { sessionId: "s2", turnId: "turn-1", costComputed: 10 },
    ];
    const items = anomalyItemsFromSamples(samples);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "anomaly",
      sessionId: "s2",
      turnId: "turn-1",
      severity: "high",
    });
    expect(items[0].summary).toMatch(/10\.0x the session median/);
  });

  it("returns no items when the population is insufficient for a baseline", () => {
    expect(
      anomalyItemsFromSamples([{ sessionId: "s1", turnId: "turn-0", costComputed: 5 }]),
    ).toEqual([]);
    expect(anomalyItemsFromSamples([])).toEqual([]);
  });
});
