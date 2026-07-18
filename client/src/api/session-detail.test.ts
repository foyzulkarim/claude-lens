import { afterEach, describe, expect, it } from "vitest";
import {
  getSessionDetail,
  SessionDetailApiError,
  SessionDetailResponseShapeError,
} from "./session-detail.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOnce(
  status: number,
  body: unknown,
  urlPredicate?: (url: string) => boolean,
): { calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    if (urlPredicate && !urlPredicate(url)) {
      return new Response("not used", { status: 404 });
    }
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

describe("getSessionDetail — happy path", () => {
  it("fetches /api/sessions/:id with the encoded id and returns the validated body", async () => {
    const body = {
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
    };
    const { calls } = mockFetchOnce(200, body);

    const result = await getSessionDetail("s1");

    expect(result.header.sessionId).toBe("s1");
    expect(calls[0]?.url).toBe("/api/sessions/s1");
  });

  it("URL-encodes session ids so a stray character never breaks the path", async () => {
    const { calls } = mockFetchOnce(404, { error: "session not found", sessionId: "abc/def" });

    await expect(getSessionDetail("abc/def")).rejects.toBeInstanceOf(SessionDetailApiError);

    expect(calls[0]?.url).toBe("/api/sessions/abc%2Fdef");
  });

  it("passes the AbortSignal through to fetch", async () => {
    const { calls } = mockFetchOnce(200, {
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
    });
    const ac = new AbortController();
    await getSessionDetail("s1", ac.signal);
    expect(calls[0]?.init?.signal).toBe(ac.signal);
  });
});

describe("getSessionDetail — error handling", () => {
  it("throws SessionDetailApiError(404) with the typed server detail for unknown ids", async () => {
    mockFetchOnce(404, { error: "session not found", sessionId: "ghost" });

    await expect(getSessionDetail("ghost")).rejects.toMatchObject({
      name: "SessionDetailApiError",
      status: 404,
      validation: "session not found",
    });
  });

  it("throws SessionDetailApiError for 5xx with the statusText fallback when no body", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 500, statusText: "Internal Server Error" })) as typeof fetch;

    await expect(getSessionDetail("any")).rejects.toMatchObject({
      name: "SessionDetailApiError",
      status: 500,
      validation: "Internal Server Error",
    });
  });

  it("throws SessionDetailResponseShapeError for a 2xx payload missing the header", async () => {
    mockFetchOnce(200, {
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
    });

    await expect(getSessionDetail("s1")).rejects.toBeInstanceOf(
      SessionDetailResponseShapeError,
    );
  });

  it("rejects a turn with a non-numeric mainCost (corrupt optional field)", async () => {
    const validHeader = {
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
    };
    mockFetchOnce(200, {
      header: validHeader,
      timeline: [],
      turns: [
        {
          turnNumber: 1,
          promptId: "p1",
          startedAt: "2026-07-14T10:00:00.000Z",
          endedAt: "2026-07-14T10:05:00.000Z",
          cost: 0.1,
          mainCost: "not-a-number",
          sidechainCost: 0,
          tokens: 100,
          inputTokens: 100,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          callCount: 1,
          cacheHitPct: 0,
          tools: [],
          fleetPercentile: null,
          isAnomaly: false,
          hasSidechain: false,
          primaryModel: "claude-sonnet-5",
          models: ["claude-sonnet-5"],
        },
      ],
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
        isEmpty: false,
        isLive: false,
        availability: [],
        fleetBaselineSize: 0,
      },
    });

    await expect(getSessionDetail("s1")).rejects.toBeInstanceOf(
      SessionDetailResponseShapeError,
    );
  });
});
