import { afterEach, describe, expect, it, vi } from "vitest";
import type { BiggestLeverView, SessionScorecardView } from "../../../shared/scorecard-contract.js";
import { getBiggestLever, getSessionScorecard, ScorecardApiError } from "./scorecard.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const gradedView: SessionScorecardView = {
  state: "graded",
  grade: "A",
  hygieneScore: 0.97,
  bands: { A: 95, B: 85, C: 70, D: 50, source: "fixed" },
  core: {
    sessionId: "s1",
    mainThreadCalls: 12,
    cacheReadTokens: 100,
    writes: [],
    decomposition: { warmup: 100, incremental: 0, rewritten: 0 },
    wasteRatio: 0,
    hitRatio: 0.5,
    scoreInputs: { confirmedFixableWaste: 0, scoreableCreation: 100 },
    hygieneScore: 0.97,
  },
  events: [],
  thresholdsUsed: { floorCalls: 10, calibrationMinSessions: 20, A: 95, B: 85, C: 70, D: 50 },
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

const tooShortView: SessionScorecardView = {
  state: "too-short",
  mainThreadCalls: 3,
  floorCalls: 10,
  core: gradedView.core,
  events: [],
  thresholdsUsed: gradedView.thresholdsUsed,
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

const noMainThreadView: SessionScorecardView = {
  state: "no-main-thread-calls",
  core: gradedView.core,
  events: [],
  thresholdsUsed: gradedView.thresholdsUsed,
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

const noScoreableView: SessionScorecardView = {
  state: "no-scoreable-creation",
  core: gradedView.core,
  events: [],
  thresholdsUsed: gradedView.thresholdsUsed,
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

const eventLever: BiggestLeverView = {
  state: "event",
  eventId: "m1",
  callId: "m1",
  promptId: null,
  turnNumber: 2,
  timestamp: "2026-07-28T00:00:00.000Z",
  model: "claude-sonnet-5",
  project: "/repo",
  branch: "main",
  kind: "prefix-bust",
  baseCause: "unexplained",
  attribution: "prefix-change",
  tokensRewritten: 500,
  costEstimate: 0.01,
  costBasis: "computed",
  deepLink: "/session/s1/turn/2",
  sessionId: "s1",
  sessionProject: "/repo",
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

const healthyLever: BiggestLeverView = {
  state: "healthy",
  firstWriteTokens: 100,
  totalCreationTokens: 100,
  firstWriteShare: 1,
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

const noActivityLever: BiggestLeverView = {
  state: "no-cache-activity",
  firstWriteTokens: 0,
  totalCreationTokens: 0,
  firstWriteShare: null,
  evaluatedAt: "2026-07-28T00:00:00.000Z",
};

describe("getSessionScorecard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["graded", gradedView],
    ["too-short", tooShortView],
    ["no-main-thread-calls", noMainThreadView],
    ["no-scoreable-creation", noScoreableView],
  ])("parses the %s discriminated variant", async (_label, view) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(view)),
    );
    const result = await getSessionScorecard("s1");
    expect(result).toEqual(view);
  });

  it("requests the session-scoped URL", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(gradedView));
    vi.stubGlobal("fetch", fetchMock);
    await getSessionScorecard("s 1");
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/s%201/scorecard", expect.anything());
  });

  it("throws ScorecardApiError with the server message on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "session not found" }, 404)),
    );
    await expect(getSessionScorecard("missing")).rejects.toThrow(ScorecardApiError);
    await expect(getSessionScorecard("missing")).rejects.toThrow(/session not found/);
  });

  it("throws ScorecardApiError on a malformed 2xx body instead of rendering undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ not: "a scorecard" })),
    );
    await expect(getSessionScorecard("s1")).rejects.toThrow(ScorecardApiError);
  });
});

describe("getBiggestLever", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["event", eventLever],
    ["healthy", healthyLever],
    ["no-cache-activity", noActivityLever],
  ])("parses the %s discriminated variant", async (_label, lever) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(lever)),
    );
    const result = await getBiggestLever({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
    });
    expect(result).toEqual(lever);
  });

  it("CSV-encodes multi-valued filters and drops empty ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(eventLever)),
    );
    await getBiggestLever({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
      project: [" /repo/a ", "", " /repo/b"],
      model: [],
    });
    const fetchMock = vi.mocked(fetch);
    const calledUrl = fetchMock.mock.calls[0]?.[0];
    const url = new URL(String(calledUrl), "http://localhost");
    expect(url.searchParams.get("project")).toBe("/repo/a,/repo/b");
    expect(url.searchParams.has("model")).toBe(false);
  });

  it("throws ScorecardApiError on a 400 malformed-range response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "from and to are required" }, 400)),
    );
    await expect(getBiggestLever({ from: "", to: "" })).rejects.toThrow(/from and to are required/);
  });

  it("throws ScorecardApiError on a malformed 2xx body instead of rendering undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ not: "a lever" })),
    );
    await expect(
      getBiggestLever({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" }),
    ).rejects.toThrow(ScorecardApiError);
  });
});
