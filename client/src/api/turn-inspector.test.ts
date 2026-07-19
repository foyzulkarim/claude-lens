import { afterEach, describe, expect, it } from "vitest";
import type { TurnInspectorResponse } from "../../../shared/turn-inspector-contract.js";
import {
  getTurnInspector,
  getTurnTranscriptPeek,
  TurnInspectorApiError,
  TurnInspectorResponseShapeError,
} from "./turn-inspector.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOnce(status: number, body: unknown): { calls: Array<{ url: string }> } {
  const calls: Array<{ url: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

function baseTurnInspectorResponse(): TurnInspectorResponse {
  return {
    summary: {
      sessionId: "s1",
      turnNumber: 1,
      totalTurns: 1,
      promptId: "p1",
      startedAt: "2026-07-14T10:00:00.000Z",
      endedAt: "2026-07-14T10:00:01.000Z",
      cost: 0.1,
      tokens: 100,
      callCount: 1,
      models: ["claude-sonnet-5"],
      primaryModel: "claude-sonnet-5",
      fleetPercentile: null,
      isAnomaly: false,
    },
    waterfall: { calls: [] },
    cacheNarrative: [],
    sidechainBreakdown: { mainCost: 0.1, mainTokens: 100, mainCallCount: 1, sidechains: [] },
    nav: { prevTurnNumber: null, nextTurnNumber: null, totalTurns: 1 },
    meta: { costBasis: "computed", availability: [], fleetBaselineSize: 0 },
  };
}

describe("getTurnInspector — happy path", () => {
  it("fetches /api/sessions/:id/turns/:n with the encoded id and validated body", async () => {
    const body = baseTurnInspectorResponse();
    const { calls } = mockFetchOnce(200, body);

    const result = await getTurnInspector("s/with spaces", 7);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/sessions/s%2Fwith%20spaces/turns/7");
    expect(result.summary.turnNumber).toBe(1);
    expect(result.meta.costBasis).toBe("computed");
  });

  it("passes the abort signal through to fetch", async () => {
    mockFetchOnce(200, baseTurnInspectorResponse());
    const controller = new AbortController();
    const captured: Array<{ init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ init });
      return new Response(JSON.stringify(baseTurnInspectorResponse()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await getTurnInspector("s1", 1, controller.signal);

    expect(captured[0]?.init?.signal).toBe(controller.signal);
  });
});

describe("getTurnInspector — error paths", () => {
  it("throws TurnInspectorApiError on 404 'session not found'", async () => {
    mockFetchOnce(404, { error: "session not found", sessionId: "unknown" });

    await expect(getTurnInspector("unknown", 1)).rejects.toMatchObject({
      name: "TurnInspectorApiError",
      status: 404,
      validation: "session not found",
    });
  });

  it("throws TurnInspectorApiError on 404 'turn not found'", async () => {
    mockFetchOnce(404, { error: "turn not found", sessionId: "s1", turnNumber: 99 });

    await expect(getTurnInspector("s1", 99)).rejects.toMatchObject({
      name: "TurnInspectorApiError",
      status: 404,
      validation: "turn not found",
    });
  });

  it("falls back to statusText when the error body is not JSON", async () => {
    mockFetchOnce(500, "boom");

    await expect(getTurnInspector("s1", 1)).rejects.toBeInstanceOf(TurnInspectorApiError);
  });
});

describe("getTurnInspector — shape guard", () => {
  it("rejects a response with a non-number fleetPercentile (string)", async () => {
    // Note: NaN/Infinity serialize as null over JSON, so they're tested
    // implicitly as the "null" branch of `isFiniteOrNull`. A non-number
    // string is the cheapest malformed value that survives the wire.
    const body = baseTurnInspectorResponse();
    (body.summary as unknown as { fleetPercentile: unknown }).fleetPercentile = "p50";
    mockFetchOnce(200, body);

    await expect(getTurnInspector("s1", 1)).rejects.toBeInstanceOf(TurnInspectorResponseShapeError);
  });

  it("rejects a response with a missing meta.costBasis", async () => {
    const body = baseTurnInspectorResponse();
    delete (body.meta as { costBasis?: string }).costBasis;
    mockFetchOnce(200, body);

    await expect(getTurnInspector("s1", 1)).rejects.toBeInstanceOf(TurnInspectorResponseShapeError);
  });

  it("rejects a response with an invalid cacheNarrative cause", async () => {
    const body = baseTurnInspectorResponse();
    body.cacheNarrative = [
      {
        callIndex: 0,
        cause: "unknown-cause",
        isWriteSpike: false,
        hitRate: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    ] as unknown as typeof body.cacheNarrative;
    mockFetchOnce(200, body);

    await expect(getTurnInspector("s1", 1)).rejects.toBeInstanceOf(TurnInspectorResponseShapeError);
  });

  it("rejects a response whose waterfall calls have non-string messageId", async () => {
    const body = baseTurnInspectorResponse();
    body.waterfall = {
      calls: [
        {
          callIndex: 0,
          messageId: 42,
          timestamp: "2026-07-14T10:00:00.000Z",
          offsetMs: 0,
          tokens: 0,
          cost: 0,
          tools: [],
          isSidechain: false,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        },
      ],
    } as unknown as typeof body.waterfall;
    mockFetchOnce(200, body);

    await expect(getTurnInspector("s1", 1)).rejects.toBeInstanceOf(TurnInspectorResponseShapeError);
  });

  it("accepts wallMs/apiMs as present or absent (premium-only fields)", async () => {
    const body: TurnInspectorResponse = baseTurnInspectorResponse();
    body.summary.wallMs = 12_000;
    mockFetchOnce(200, body);

    const result = await getTurnInspector("s1", 1);

    expect(result.summary.wallMs).toBe(12_000);
  });
});

describe("getTurnTranscriptPeek — happy path", () => {
  it("fetches /api/sessions/:id/transcript?turn=n and validates the response shape", async () => {
    mockFetchOnce(200, {
      lines: [
        { role: "assistant-text", preview: "ok" },
        { role: "tool-use", toolName: "Read", preview: '{"file":"/x"}' },
      ],
      truncated: false,
    });

    const result = await getTurnTranscriptPeek("s/with spaces", 3);

    expect(result.lines).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("accepts a result with no in-window lines (empty array)", async () => {
    mockFetchOnce(200, { lines: [], truncated: false });
    const result = await getTurnTranscriptPeek("s1", 1);
    expect(result.lines).toEqual([]);
  });
});

describe("getTurnTranscriptPeek — error paths", () => {
  it("throws TurnInspectorApiError on 404 'transcript unavailable'", async () => {
    mockFetchOnce(404, {
      error: "transcript unavailable",
      sessionId: "s1",
      turnNumber: 1,
    });

    await expect(getTurnTranscriptPeek("s1", 1)).rejects.toMatchObject({
      name: "TurnInspectorApiError",
      status: 404,
      validation: "transcript unavailable",
    });
  });
});

describe("getTurnTranscriptPeek — shape guard", () => {
  it("rejects a response with an invalid role", async () => {
    mockFetchOnce(200, {
      lines: [{ role: "garbage", preview: "x" }],
      truncated: false,
    });
    await expect(getTurnTranscriptPeek("s1", 1)).rejects.toBeInstanceOf(
      TurnInspectorResponseShapeError,
    );
  });

  it("rejects a response with truncated != boolean", async () => {
    mockFetchOnce(200, {
      lines: [],
      truncated: "false",
    });
    await expect(getTurnTranscriptPeek("s1", 1)).rejects.toBeInstanceOf(
      TurnInspectorResponseShapeError,
    );
  });
});
