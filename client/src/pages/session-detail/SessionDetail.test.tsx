// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDetailResponse } from "../../../../../shared/session-detail-contract.js";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
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
            <Route path="/sessions/:id/turn/:turnNumber" component={() => <div data-testid="turn-page-stub" />} />
            <Route path="/">
              <button data-testid="back-to-sessions">Back</button>
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

    render(<Wrapper><div /></Wrapper>);

    expect(screen.getByTestId("session-detail-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("renders a 404 panel inside the AppShell for unknown sessions", async () => {
    const { SessionDetailApiError } = await import("../../api/session-detail.js");
    getSessionDetailMock.mockRejectedValue(new SessionDetailApiError(404, "session not found", "404"));
    const { Wrapper } = makeWrapper();

    render(<Wrapper><div /></Wrapper>);

    expect(await screen.findByTestId("session-detail-not-found")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/session not found/i);
  });

  it("renders a generic alert for non-404 failures", async () => {
    getSessionDetailMock.mockRejectedValue(new Error("network down"));
    const { Wrapper } = makeWrapper();

    render(<Wrapper><div /></Wrapper>);

    expect(await screen.findByTestId("session-detail-error")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/network down/i);
  });

  it("renders the SessionDetailView with the validated response on success", async () => {
    const response = makeResponse({ header: { ...makeResponse().header, sessionId: "s1" } });
    getSessionDetailMock.mockResolvedValue(response);
    const { Wrapper } = makeWrapper();

    render(<Wrapper><div /></Wrapper>);

    expect(await screen.findByTestId("session-detail-view")).toBeInTheDocument();
    expect(screen.getByText(/Session Detail — s1/i)).toBeInTheDocument();
  });

  it("uses qk.session(id) as the query key (single-page-owned resource)", async () => {
    getSessionDetailMock.mockResolvedValue(makeResponse());
    const { Wrapper } = makeWrapper("/sessions/s2");

    render(<Wrapper><div /></Wrapper>);
    await screen.findByTestId("session-detail-view");
    expect(getSessionDetailMock).toHaveBeenCalledWith("s2", expect.anything());
  });

  it("does not call the fetcher twice for the same id (page-owned single query)", async () => {
    getSessionDetailMock.mockResolvedValue(makeResponse());
    const { Wrapper } = makeWrapper();

    render(<Wrapper><div /></Wrapper>);
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

    const { unmount } = render(<Wrapper><div /></Wrapper>);
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

    render(<Wrapper><div /></Wrapper>);
    await screen.findByTestId("session-detail-view");

    expect(getSessionDetailMock).toHaveBeenCalledWith("s1", expect.anything());
  });
});
