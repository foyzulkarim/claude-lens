// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CacheScorecardCore,
  ScorecardThresholds,
  SessionScorecardView,
  WasteEventView,
} from "../../../../shared/scorecard-contract.js";
import { Scorecard, ScorecardView } from "./Scorecard.js";

vi.mock("../../hooks/useInView.js", () => ({
  useInView: <T extends HTMLElement>(_opts: IntersectionObserverInit = {}, _fallback = false) => {
    void (null as T | null);
    return { ref: { current: null }, inView: true };
  },
}));

const THRESHOLDS: ScorecardThresholds = {
  floorCalls: 10,
  calibrationMinSessions: 20,
  A: 95,
  B: 85,
  C: 70,
  D: 50,
};

function buildCore(overrides: Partial<CacheScorecardCore> = {}): CacheScorecardCore {
  return {
    sessionId: "s1",
    mainThreadCalls: 24,
    cacheReadTokens: 480_000,
    writes: [],
    decomposition: { warmup: 100_000, incremental: 320_000, rewritten: 40_000 },
    wasteRatio: 0.087,
    hitRatio: 0.72,
    scoreInputs: { confirmedFixableWaste: 40_000, scoreableCreation: 460_000 },
    hygieneScore: 0.91,
    ...overrides,
  };
}

function buildEvent(overrides: Partial<WasteEventView> = {}): WasteEventView {
  return {
    eventId: "m42",
    callId: "m42",
    promptId: "p9",
    turnNumber: 6,
    timestamp: "2026-07-20T12:04:00.000Z",
    model: "claude-sonnet-5",
    project: "/repo/alpha",
    branch: "main",
    kind: "prefix-bust",
    baseCause: "unexplained",
    attribution: "prefix-change",
    tokensRewritten: 40_000,
    costEstimate: 0.14,
    costBasis: "computed",
    deepLink: "/session/s1/turn/6",
    ...overrides,
  };
}

function gradedView(overrides: Partial<SessionScorecardView> = {}): SessionScorecardView {
  return {
    state: "graded",
    grade: "B",
    hygieneScore: 0.91,
    bands: { A: 95, B: 85, C: 70, D: 50, source: "fixed" },
    core: buildCore(),
    events: [buildEvent()],
    thresholdsUsed: THRESHOLDS,
    evaluatedAt: "2026-07-20T12:30:00.000Z",
    ...overrides,
  } as SessionScorecardView;
}

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(cleanup);

describe("Scorecard (fetch wrapper)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the lazy-mount placeholder when out of view", async () => {
    const useInView = await import("../../hooks/useInView.js");
    vi.spyOn(useInView, "useInView").mockReturnValueOnce({ ref: { current: null }, inView: false });
    render(<Scorecard sessionId="s1" />, { wrapper: makeWrapper() });
    expect(screen.getByTestId("scorecard-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("cache-scorecard")).toBeNull();
  });

  it("renders the loading state while the fetch is pending", async () => {
    const api = await import("../../api/scorecard.js");
    vi.spyOn(api, "getSessionScorecard").mockReturnValueOnce(new Promise(() => {}) as never);
    render(<Scorecard sessionId="s1" />, { wrapper: makeWrapper() });
    expect(screen.getByRole("status")).toHaveTextContent(/Loading Cache Scorecard/i);
  });

  it("renders the error EmptyState with a retry affordance when the fetch fails", async () => {
    const api = await import("../../api/scorecard.js");
    vi.spyOn(api, "getSessionScorecard").mockRejectedValueOnce(new Error("boom"));
    render(<Scorecard sessionId="s1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText(/Couldn't load Cache Scorecard/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the ScorecardView on success", async () => {
    const api = await import("../../api/scorecard.js");
    vi.spyOn(api, "getSessionScorecard").mockResolvedValueOnce(gradedView());
    render(<Scorecard sessionId="s1" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByTestId("cache-scorecard")).toBeInTheDocument();
    });
  });
});

describe("ScorecardView", () => {
  it("renders a grade badge for a graded session", () => {
    render(<ScorecardView data={gradedView()} />);
    expect(screen.getByText("Hygiene B")).toBeInTheDocument();
    // #124 review finding #21: the aria-label is prefixed with the badge's
    // own label ("Hygiene B"), not the generic "Score: B" ReportCard's
    // badge uses, so the two grades stay distinguishable on the same page.
    expect(screen.getByRole("img", { name: /Hygiene B: B/i })).toBeInTheDocument();
  });

  it.each([
    [
      "too-short",
      { state: "too-short" as const, mainThreadCalls: 4, floorCalls: 10 },
      /too short/i,
    ],
    ["no-main-thread-calls", { state: "no-main-thread-calls" as const }, /no main-thread/i],
    ["no-scoreable-creation", { state: "no-scoreable-creation" as const }, /no scoreable/i],
  ])("renders an explicit reason (never F or 0) for %s", (_label, stateFields, matcher) => {
    render(
      <ScorecardView
        data={
          {
            core: buildCore(),
            events: [],
            thresholdsUsed: THRESHOLDS,
            evaluatedAt: "2026-07-20T12:30:00.000Z",
            ...stateFields,
          } as SessionScorecardView
        }
      />,
    );
    const reason = screen.getByTestId("scorecard-ungraded-reason");
    expect(reason).toHaveTextContent(matcher);
    expect(reason.textContent).not.toMatch(/^F$/);
    expect(reason.textContent).not.toMatch(/^0$/);
  });

  it("renders the R1 metrics from the wire", () => {
    render(<ScorecardView data={gradedView()} />);
    expect(screen.getByText("480.0k")).toBeInTheDocument(); // cache reads
    expect(screen.getByText("100.0k")).toBeInTheDocument(); // warmup
    expect(screen.getByText("320.0k")).toBeInTheDocument(); // incremental
    expect(screen.getByText("40.0k")).toBeInTheDocument(); // rewritten
    expect(screen.getByText("9%")).toBeInTheDocument(); // waste ratio
    expect(screen.getByText("72%")).toBeInTheDocument(); // hit ratio
  });

  it("renders one row per waste event with kind, tokens, and dollars", () => {
    render(<ScorecardView data={gradedView()} />);
    const row = screen.getByTestId("waste-event-m42");
    expect(row).toHaveTextContent("prefix bust");
    expect(row).toHaveTextContent("40.0k rewritten");
    expect(row).toHaveTextContent("$0.14");
  });

  it('renders "unexplained" (not "unattributed") when attribution is unknown', () => {
    render(
      <ScorecardView
        data={gradedView({
          events: [buildEvent({ eventId: "m50", kind: "unattributed", attribution: "unknown" })],
        })}
      />,
    );
    expect(screen.getByTestId("waste-event-m50")).toHaveTextContent("unexplained");
  });

  it("renders 'unavailable' — never $0.00 — when costEstimate is null", () => {
    render(
      <ScorecardView
        data={gradedView({
          events: [buildEvent({ costEstimate: null, costBasis: "unavailable" })],
        })}
      />,
    );
    const row = screen.getByTestId("waste-event-m42");
    expect(row).toHaveTextContent("unavailable");
    expect(row).not.toHaveTextContent("$0.00");
  });

  it("deep-links a turn-resolved event to Turn Inspector", () => {
    render(<ScorecardView data={gradedView()} />);
    const link = screen.getByRole("link", { name: /Open turn 6 in Turn Inspector/i });
    expect(link).toHaveAttribute("href", "/session/s1/turn/6");
  });

  it("deep-links a null-turn event to the session's scorecard anchor", () => {
    render(
      <ScorecardView
        data={gradedView({
          events: [
            buildEvent({
              turnNumber: null,
              deepLink: "/sessions/s1#cache-scorecard",
            }),
          ],
        })}
      />,
    );
    const link = screen.getByRole("link", {
      name: /Open the Cache Scorecard section for the prefix bust event at 2026-07-20T12:04:00\.000Z/i,
    });
    expect(link).toHaveAttribute("href", "/sessions/s1#cache-scorecard");
  });

  it("gives two null-turn events distinct accessible names instead of an identical repeated link (#124 review finding #20)", () => {
    render(
      <ScorecardView
        data={gradedView({
          events: [
            buildEvent({
              eventId: "m50",
              turnNumber: null,
              timestamp: "2026-07-20T12:04:00.000Z",
              kind: "unattributed",
              deepLink: "/sessions/s1#cache-scorecard",
            }),
            buildEvent({
              eventId: "m51",
              turnNumber: null,
              timestamp: "2026-07-20T13:10:00.000Z",
              kind: "idle-expiry",
              deepLink: "/sessions/s1#cache-scorecard",
            }),
          ],
        })}
      />,
    );
    const links = screen.getAllByRole("link", { name: /Cache Scorecard section/i });
    expect(links).toHaveLength(2);
    const names = links.map((link) => link.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  it("exposes the cache-scorecard anchor id for the R6/#3 fallback deep link", () => {
    render(<ScorecardView data={gradedView()} />);
    expect(screen.getByTestId("cache-scorecard")).toHaveAttribute("id", "cache-scorecard");
  });
});
