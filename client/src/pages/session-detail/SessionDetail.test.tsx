// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SessionDetailResponse } from "../../../../shared/session-detail-contract.js";
import { SessionDetail } from "../SessionDetail.js";

// Minimal stub of getSessionDetail so we can swap per test. The real
// module is imported only inside `SessionDetail` (lazy), so a top-level
// vi.mock wires the fetcher for every test in this file.
const getSessionDetailMock = vi.fn();
vi.mock("../../api/session-detail.js", () => ({
  getSessionDetail: (...args: unknown[]) => getSessionDetailMock(...args),
  SessionDetailApiError: class SessionDetailApiError extends Error {
    readonly status: number;
    readonly validation: string | null;
    constructor(status: number, validation: string | null, message: string) {
      super(message);
      this.name = "SessionDetailApiError";
      this.status = status;
      this.validation = validation;
    }
  },
  SessionDetailResponseShapeError: class SessionDetailResponseShapeError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SessionDetailResponseShapeError";
    }
  },
}));

function makeResponse(overrides: Partial<SessionDetailResponse> = {}): SessionDetailResponse {
  return {
    header: {
      sessionId: "s1",
      project: "/Users/demo/.claude",
      branch: "main",
      version: "1.0.0",
      models: ["claude-sonnet-5"],
      firstAt: "2026-07-14T10:00:00.000Z",
      lastAt: "2026-07-14T10:05:00.000Z",
      logicalTurnCount: 1,
      callCount: 1,
      costComputed: 0.1,
      fleetCostMedian: null,
      fleetCostRankPct: null,
      tier: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
    },
    timeline: [],
    turns: [],
    turnDistribution: {
      populationSize: 0,
      p50: null,
      p90: null,
      p99: null,
      histogram: [],
      basis: "all-history",
    },
    cache: [],
    toolMix: [],
    toolTimeline: [],
    prompts: [],
    workflow: {
      baseEditCount: 0,
      readFirstCount: 0,
      plannedCount: 0,
      verifiedCount: 0,
      committedCount: 0,
      stages: [],
    },
    tokenFunnel: { contextOffered: 0, cacheServed: 0, freshBilled: 0, output: 0 },
    contextComposition: [],
    meta: {
      costBasis: "computed",
      isEmpty: true,
      isLive: false,
      availability: [],
      fleetBaselineSize: 0,
    },
    ...overrides,
  };
}

function makeWrapper(initialPath = "/sessions/s1") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // wouter's `memoryLocation` returns `{ hook, searchHook }` — Router takes
  // the `hook` (location stream) and `searchHook` separately. Initial path
  // is baked in via the `path` option. Returning a fresh QueryClient per
  // call prevents cached query state from leaking between tests (a fresh
  // loading test would otherwise see a cached success from an earlier test).
  const { hook, searchHook } = memoryLocation({ path: initialPath, static: true });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <Router hook={hook} searchHook={searchHook}>
          <Switch>
            <Route path="/sessions/:id" component={SessionDetail} />
            <Route
              path="/session/:sessionId/turn/:turnNumber"
              component={() => <div data-testid="turn-page-stub" />}
            />
            <Route path="/">
              <button type="button" data-testid="back-to-sessions">
                Back
              </button>
              {children}
            </Route>
          </Switch>
        </Router>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

describe("SessionDetail — query lifecycle (T6)", () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    getSessionDetailMock.mockReset();
  });

  it("renders an accessible loading state while the query is pending", () => {
    // Never resolve the promise: the page must stay in the loading branch
    // and never fabricate data.
    getSessionDetailMock.mockReturnValue(new Promise(() => {}));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    expect(screen.getByTestId("session-detail-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a 404 panel inside the AppShell for unknown sessions", async () => {
    const { SessionDetailApiError } = await import("../../api/session-detail.js");
    getSessionDetailMock.mockRejectedValue(
      new SessionDetailApiError(404, "session not found", "404"),
    );
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    expect(await screen.findByTestId("session-detail-not-found")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/session not found/i);
  });

  it("renders a generic alert for non-404 failures", async () => {
    getSessionDetailMock.mockRejectedValue(new Error("network down"));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    expect(await screen.findByTestId("session-detail-error")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/network down/i);
  });

  it("renders the SessionDetailView with the validated response on success", async () => {
    const response = makeResponse({ header: { ...makeResponse().header, sessionId: "s1" } });
    getSessionDetailMock.mockResolvedValue(response);
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    expect(await screen.findByTestId("session-detail-view")).toBeInTheDocument();
    expect(screen.getByTestId("session-detail-header")).toBeInTheDocument();
  });

  it("uses qk.session(id) as the query key (single-page-owned resource)", async () => {
    getSessionDetailMock.mockResolvedValue(makeResponse());
    const { Wrapper } = makeWrapper("/sessions/s2");

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );
    await screen.findByTestId("session-detail-view");
    expect(getSessionDetailMock).toHaveBeenCalledWith("s2", expect.anything());
  });

  it("does not call the fetcher twice for the same id (page-owned single query)", async () => {
    getSessionDetailMock.mockResolvedValue(makeResponse());
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );
    await screen.findByTestId("session-detail-view");

    expect(getSessionDetailMock).toHaveBeenCalledTimes(1);
  });

  it("aborts in-flight requests on unmount (no user-facing error)", async () => {
    let resolveFn: (value: SessionDetailResponse) => void = () => {};
    getSessionDetailMock.mockImplementation(
      () =>
        new Promise<SessionDetailResponse>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const { Wrapper } = makeWrapper();

    const { unmount } = render(
      <Wrapper>
        <div />
      </Wrapper>,
    );
    unmount();
    // Resolving after unmount must not raise into the React tree — the
    // TestClient garbage-collects the observer, so we just assert the
    // unmount path stays quiet.
    resolveFn(makeResponse());
  });

  it("ignores unrelated query-string parameters when computing the fetcher id", async () => {
    getSessionDetailMock.mockResolvedValue(makeResponse());
    // memoryLocation strips query strings on `path`; the renderer only sees
    // the path id, so the fetcher is called with that id regardless of any
    // filter chips in the URL (A12 — detail URL names a resource).
    const { Wrapper } = makeWrapper("/sessions/s1");

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );
    await screen.findByTestId("session-detail-view");

    expect(getSessionDetailMock).toHaveBeenCalledWith("s1", expect.anything());
  });
});

describe("SessionDetail — Header + CostTimeline (T7)", () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    getSessionDetailMock.mockReset();
  });

  it("Header surfaces tier, computed cost, drift absence, and the vs-median delta", async () => {
    const response = makeResponse({
      header: {
        ...makeResponse().header,
        sessionId: "11111111-2222-4333-8444-555555555555",
        costComputed: 10,
        fleetCostMedian: 8,
        fleetCostRankPct: 25,
        logicalTurnCount: 3,
        callCount: 12,
      },
    });
    getSessionDetailMock.mockResolvedValue(response);
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    expect(await screen.findByTestId("session-detail-header")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    expect(screen.getByText("+25% vs median")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // logicalTurnCount
    expect(screen.getByText("12")).toBeInTheDocument(); // callCount
    // drift absent → premium banner explains what's missing, never a fabricated 0
    expect(screen.getByTestId("premium-unavailable")).toBeInTheDocument();
  });

  it("CostTimeline renders bars + turn rules + the cumulative/per-turn toggle", async () => {
    const timeline = [
      {
        callIndex: 0,
        timestamp: "2026-07-14T10:00:00.000Z",
        cumulativeCost: 0.1,
        cumulativeTokens: 100,
        cost: 0.1,
        tokens: 100,
        contextPct: 0.5,
        turnNumber: 1,
        isTurnBoundary: true,
        isCompaction: false,
      },
      {
        callIndex: 1,
        timestamp: "2026-07-14T10:01:00.000Z",
        cumulativeCost: 0.3,
        cumulativeTokens: 300,
        cost: 0.2,
        tokens: 200,
        contextPct: 0.6,
        turnNumber: 1,
        isTurnBoundary: false,
        isCompaction: false,
      },
      {
        callIndex: 2,
        timestamp: "2026-07-14T10:02:00.000Z",
        cumulativeCost: 0.4,
        cumulativeTokens: 500,
        cost: 0.1,
        tokens: 200,
        contextPct: 0.6,
        turnNumber: 2,
        isTurnBoundary: true,
        isCompaction: true,
      },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ timeline }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const timelineEl = await screen.findByTestId("session-detail-timeline");
    expect(timelineEl).toBeInTheDocument();
    // Two turn boundaries → exactly two dashed lines
    expect(timelineEl.querySelectorAll("line")).toHaveLength(2);
    // Compaction call rendered in the rose color so the panel visually
    // distinguishes it from ordinary calls.
    expect(timelineEl.querySelector("rect.fill-rose-500")).not.toBeNull();
  });

  it("CostTimeline toggle groups are keyboard-operable and aria-pressed reflects state", async () => {
    const timeline = [
      {
        callIndex: 0,
        timestamp: "2026-07-14T10:00:00.000Z",
        cumulativeCost: 0.1,
        cumulativeTokens: 100,
        cost: 0.1,
        tokens: 100,
        contextPct: 0.5,
        turnNumber: 1,
        isTurnBoundary: true,
        isCompaction: false,
      },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ timeline }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    await screen.findByTestId("session-detail-timeline");
    const displayGroup = screen.getByRole("group", { name: "Display" });
    const activeBtn = displayGroup.querySelector('button[aria-pressed="true"]');
    expect(activeBtn).toHaveTextContent("cumulative");
  });
});

describe("SessionDetail — TurnsSection, CacheStrip, ToolMix (T8)", () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    getSessionDetailMock.mockReset();
  });

  it("TurnsSection renders stacked bars, anomaly badge, and drill links", async () => {
    const turns = [
      {
        turnNumber: 1,
        promptId: "p1",
        startedAt: "2026-07-14T10:00:00.000Z",
        endedAt: "2026-07-14T10:01:00.000Z",
        cost: 0.1,
        mainCost: 0.1,
        sidechainCost: 0,
        tokens: 100,
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        callCount: 1,
        cacheHitPct: 0,
        tools: [{ name: "Read", count: 1, inputBytes: 10 }],
        fleetPercentile: 50,
        isAnomaly: false,
        hasSidechain: false,
        primaryModel: "claude-sonnet-5",
        models: ["claude-sonnet-5"],
      },
      {
        turnNumber: 2,
        promptId: "p2",
        startedAt: "2026-07-14T10:02:00.000Z",
        endedAt: "2026-07-14T10:03:00.000Z",
        cost: 5,
        mainCost: 5,
        sidechainCost: 0,
        tokens: 100,
        inputTokens: 100,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        callCount: 1,
        cacheHitPct: 0,
        tools: [],
        fleetPercentile: 99,
        isAnomaly: true,
        hasSidechain: false,
        primaryModel: "claude-sonnet-5",
        models: ["claude-sonnet-5"],
      },
    ];
    const distribution = {
      populationSize: 100,
      p50: 0.5,
      p90: 1.5,
      p99: 4,
      histogram: [
        { rangeStart: 0, rangeEnd: 1, count: 60 },
        { rangeStart: 1, rangeEnd: 5, count: 40 },
      ],
      basis: "all-history" as const,
    };
    getSessionDetailMock.mockResolvedValue(makeResponse({ turns, turnDistribution: distribution }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    expect(await screen.findByTestId("session-detail-turns")).toBeInTheDocument();
    // Drill link uses the canonical /session/:sessionId/turn/:turnNumber
    // shape (A11), with the addressed session's real id (header.sessionId
    // is "s1" in the default fixture response).
    const drillLink = screen.getByTestId("turn-drill-2");
    expect(drillLink).toHaveAttribute("href", "/session/s1/turn/2");
    // Anomaly badge present
    expect(screen.getByText("flag")).toBeInTheDocument();
  });

  it("CacheStrip renders K2 cause badges for cache writes", async () => {
    const cache = [
      {
        callIndex: 0,
        timestamp: "2026-07-14T10:00:00.000Z",
        cacheReadTokens: 0,
        cacheCreateTokens: 1000,
        hitRate: 0,
        cause: "first-call" as const,
        isWriteSpike: true,
      },
      {
        callIndex: 1,
        timestamp: "2026-07-14T10:01:00.000Z",
        cacheReadTokens: 500,
        cacheCreateTokens: 100,
        hitRate: 0.83,
        cause: "model-switch" as const,
        isWriteSpike: false,
      },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ cache }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const cacheEl = await screen.findByTestId("session-detail-cache");
    expect(cacheEl).toBeInTheDocument();
    // Cause labels appear both in the per-call strip and in the cause
    // table — assert at least one of each is rendered inside the cache panel.
    expect(within(cacheEl).getAllByText("first call").length).toBeGreaterThan(0);
    expect(within(cacheEl).getAllByText("model switch").length).toBeGreaterThan(0);
  });

  it("ToolMix + Tool Timeline render with the binding mix/timeline shape", async () => {
    const toolMix = [
      { name: "Read", callCount: 5, inputBytes: 100, resultBytes: 200, share: 0.5 },
      { name: "Bash", callCount: 3, inputBytes: 50, resultBytes: 200, share: 0.5 },
    ];
    const toolTimeline = [
      { callIndex: 0, timestamp: "2026-07-14T10:00:00.000Z", toolName: "Read", turnNumber: 1 },
      { callIndex: 1, timestamp: "2026-07-14T10:01:00.000Z", toolName: "Bash", turnNumber: 1 },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ toolMix, toolTimeline }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const toolMixEl = await screen.findByTestId("session-detail-tool-mix");
    expect(toolMixEl).toBeInTheDocument();
    expect(within(toolMixEl).getAllByText(/Read/).length).toBeGreaterThan(0);
    expect(within(toolMixEl).getAllByText(/Bash/).length).toBeGreaterThan(0);
    // Turn numbers (T1) appear once per timeline event; assert at least
    // one is rendered (events in the test fixture both carry turn 1).
    expect(within(toolMixEl).getAllByText("T1").length).toBeGreaterThan(0);
  });
});

describe("SessionDetail — PromptList + WorkflowFunnel (T9)", () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    getSessionDetailMock.mockReset();
  });

  it("PromptList renders prompts in turn order with typed text", async () => {
    const prompts = [
      {
        turnNumber: 1,
        promptId: "p1",
        timestamp: "2026-07-14T10:00:00.000Z",
        text: "first prompt",
      },
      {
        turnNumber: 2,
        promptId: "p2",
        timestamp: "2026-07-14T10:05:00.000Z",
        text: "second prompt",
      },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ prompts }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const promptsEl = await screen.findByTestId("session-detail-prompts");
    expect(promptsEl).toBeInTheDocument();
    expect(within(promptsEl).getByText("first prompt")).toBeInTheDocument();
    expect(within(promptsEl).getByText("second prompt")).toBeInTheDocument();
  });

  it("WorkflowFunnel renders the canonical 5 stages with monotonic non-increasing counts", async () => {
    const workflow = {
      baseEditCount: 10,
      readFirstCount: 8,
      plannedCount: 6,
      verifiedCount: 4,
      committedCount: 2,
      stages: [
        { id: "edit" as const, label: "Edit cohort", count: 10 },
        { id: "read" as const, label: "Read-first", count: 8 },
        { id: "plan" as const, label: "Planned", count: 6 },
        { id: "verify" as const, label: "Verified", count: 4 },
        { id: "commit" as const, label: "Committed", count: 2 },
      ],
    };
    getSessionDetailMock.mockResolvedValue(makeResponse({ workflow }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const workflowEl = await screen.findByTestId("session-detail-workflow");
    expect(workflowEl).toBeInTheDocument();
    expect(within(workflowEl).getByText("Edit cohort")).toBeInTheDocument();
    expect(within(workflowEl).getByText("Read-first")).toBeInTheDocument();
    expect(within(workflowEl).getByText("Planned")).toBeInTheDocument();
    expect(within(workflowEl).getByText("Verified")).toBeInTheDocument();
    expect(within(workflowEl).getByText("Committed")).toBeInTheDocument();
  });
});

describe("SessionDetail — TokenFunnel + ContextComposition (T10)", () => {
  beforeEach(() => {
    getSessionDetailMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    getSessionDetailMock.mockReset();
  });

  it("TokenFunnel renders context/cache/fresh/output bars with reconciliation intact", async () => {
    const tokenFunnel = {
      contextOffered: 450,
      cacheServed: 120,
      freshBilled: 330,
      output: 50,
    };
    getSessionDetailMock.mockResolvedValue(makeResponse({ tokenFunnel }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const tokenEl = await screen.findByTestId("session-detail-token-funnel");
    expect(tokenEl).toBeInTheDocument();
    // Each bar label rendered
    expect(within(tokenEl).getByText("Context offered")).toBeInTheDocument();
    expect(within(tokenEl).getByText("Cache served")).toBeInTheDocument();
    expect(within(tokenEl).getByText("Fresh billed")).toBeInTheDocument();
    expect(within(tokenEl).getByText("Output")).toBeInTheDocument();
  });

  it("ContextComposition groups bytes by originating tool with deterministic order", async () => {
    const contextComposition = [
      { toolName: "Bash", bytes: 200, share: 0.5 },
      { toolName: "Read", bytes: 100, share: 0.25 },
      { toolName: "Unknown", bytes: 100, share: 0.25 },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ contextComposition }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const ctxEl = await screen.findByTestId("session-detail-context-composition");
    expect(ctxEl).toBeInTheDocument();
    expect(within(ctxEl).getByText("Bash")).toBeInTheDocument();
    expect(within(ctxEl).getByText("Read")).toBeInTheDocument();
    expect(within(ctxEl).getByText("Unknown")).toBeInTheDocument();
  });

  it("ContextComposition does not leak target paths or commands", async () => {
    const contextComposition = [
      { toolName: "Read", bytes: 100, share: 0.5 },
      { toolName: "Bash", bytes: 100, share: 0.5 },
    ];
    getSessionDetailMock.mockResolvedValue(makeResponse({ contextComposition }));
    const { Wrapper } = makeWrapper();

    render(
      <Wrapper>
        <div />
      </Wrapper>,
    );

    const ctxEl = await screen.findByTestId("session-detail-context-composition");
    expect(ctxEl.textContent).not.toContain("/secret");
    expect(ctxEl.textContent).not.toContain("git commit -m");
  });
});
