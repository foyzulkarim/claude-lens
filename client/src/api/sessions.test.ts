import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionListResponse } from "../../../shared/sessions-contract.js";
import { listSessions, SessionsApiError } from "./sessions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

const EMPTY_RESPONSE: SessionListResponse = {
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

function installFetch(
  responder: (url: string, init: RequestInit | undefined) => Promise<Response>,
): void {
  const fakeFetch = vi.fn(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return responder(url, init);
    },
  );
  vi.stubGlobal("fetch", fakeFetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// URL encoding
// ---------------------------------------------------------------------------

describe("listSessions — URL encoding", () => {
  it("sends allowed query fields verbatim", async () => {
    let capturedUrl = "";
    installFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(EMPTY_RESPONSE);
    });

    await listSessions({ sort: "costComputed", limit: 10 });
    expect(capturedUrl).toBe("/api/sessions?sort=costComputed&limit=10");
  });

  it("includes every documented scalar in insertion order", async () => {
    let capturedUrl = "";
    installFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(EMPTY_RESPONSE);
    });

    await listSessions({
      sort: "lastAt",
      order: "desc",
      offset: 20,
      limit: 25,
      from: "2026-07-01",
      to: "2026-07-10",
      include: "trace",
    });
    expect(capturedUrl).toBe(
      "/api/sessions?sort=lastAt&order=desc&offset=20&limit=25&from=2026-07-01&to=2026-07-10&include=trace",
    );
  });

  it("CSV-encodes multi-valued filters", async () => {
    let capturedUrl = "";
    installFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(EMPTY_RESPONSE);
    });

    await listSessions({ project: ["alpha", "beta"], model: ["opus", "sonnet"] });
    expect(capturedUrl).toBe("/api/sessions?project=alpha%2Cbeta&model=opus%2Csonnet");
  });

  it("omits empty strings and empty arrays from the URL", async () => {
    let capturedUrl = "";
    installFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(EMPTY_RESPONSE);
    });

    await listSessions({
      limit: undefined,
      from: "",
      to: "",
      project: [],
      model: ["", "  "],
      branch: [""],
      include: undefined,
    });
    expect(capturedUrl).toBe("/api/sessions");
  });

  it("keeps zero-valued offsets and limits (not-empty is not the same as not-zero)", async () => {
    let capturedUrl = "";
    installFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(EMPTY_RESPONSE);
    });

    await listSessions({ offset: 0, limit: 1 });
    expect(capturedUrl).toBe("/api/sessions?offset=0&limit=1");
  });

  it("encodes opt-in trace without dropping other params", async () => {
    let capturedUrl = "";
    installFetch(async (url) => {
      capturedUrl = url;
      return makeResponse(EMPTY_RESPONSE);
    });

    await listSessions({ sort: "lastAt", limit: 5, include: "trace" });
    expect(capturedUrl).toBe("/api/sessions?sort=lastAt&limit=5&include=trace");
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe("listSessions — error path", () => {
  it("decodes a 400 with a typed SessionsApiError carrying the validation message", async () => {
    installFetch(async () =>
      makeResponse(
        {
          error:
            "sort must be one of lastAt, costComputed, durationMs, cacheSavingsComputed, maxTurnCostComputed",
        },
        { status: 400 },
      ),
    );

    let caught: unknown;
    try {
      await listSessions({ sort: "bogus" as never });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SessionsApiError);
    const err = caught as SessionsApiError;
    expect(err.status).toBe(400);
    expect(err.validation).toMatch(/sort must be one of/);
    expect(err.message).toContain("GET /api/sessions failed (400)");
  });

  it("decodes a non-2xx without a body and exposes null validation", async () => {
    installFetch(async () => new Response(null, { status: 500 }));

    await expect(listSessions()).rejects.toMatchObject({
      name: "SessionsApiError",
      status: 500,
      validation: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe("listSessions — success path", () => {
  it("returns the typed SessionListResponse", async () => {
    const body: SessionListResponse = {
      items: [
        {
          sessionId: "s1",
          startedAt: "2026-07-01T00:00:00Z",
          lastAt: "2026-07-01T00:05:00Z",
          project: "demo",
          model: "opus",
          durationMs: 300_000,
          turnCount: 4,
          costComputed: 1.25,
          trace: [{ turnIndex: 0, cost: 0.5, timestamp: "2026-07-01T00:01:00Z" }],
        },
      ],
      total: 1,
      meta: {
        matchedExtent: { from: "2026-07-01T00:00:00Z", to: "2026-07-01T00:05:00Z" },
        globalCapture: {
          hasCostSamples: true,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "observed",
        },
      },
    };
    installFetch(async () => makeResponse(body));

    const result = await listSessions({ include: "trace" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.sessionId).toBe("s1");
    expect(result.items[0]?.trace).toEqual([
      { turnIndex: 0, cost: 0.5, timestamp: "2026-07-01T00:01:00Z" },
    ]);
    expect(result.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shape guard (review #15 / TS1)
// ---------------------------------------------------------------------------

describe("listSessions — response shape guard", () => {
  // Five mounted Dashboard consumers immediately dereference `items` and the
  // nested `meta.globalCapture` — pre-fix the wrapper cast `unknown` straight
  // to `SessionListResponse`, so a malformed or version-skewed 2xx could
  // crash during render rather than surface at the API boundary. The
  // shape guard now runs first and any structural failure throws
  // `SessionsResponseShapeError`, so TanStack Query's `isError` boundary
  // engages instead.

  function responseWithItem(itemOverrides: Record<string, unknown> = {}): unknown {
    return {
      items: [
        {
          sessionId: "s1",
          startedAt: "2026-07-01T00:00:00Z",
          lastAt: "2026-07-01T00:05:00Z",
          project: "demo",
          model: "opus",
          durationMs: 300_000,
          turnCount: 4,
          costComputed: 1.25,
          ...itemOverrides,
        },
      ],
      total: 1,
      meta: {
        matchedExtent: { from: "2026-07-01T00:00:00Z", to: "2026-07-01T00:05:00Z" },
        globalCapture: {
          hasCostSamples: true,
          hasTurnBoundaries: true,
          hasCostLog: false,
          costBasis: "computed",
        },
      },
    };
  }

  it("throws SessionsResponseShapeError when `items` is not an array", async () => {
    installFetch(async () =>
      makeResponse({
        items: "not an array",
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
      }),
    );
    await expect(listSessions()).rejects.toMatchObject({
      name: "SessionsResponseShapeError",
    });
  });

  it("throws SessionsResponseShapeError when an item is missing required fields", async () => {
    installFetch(async () =>
      makeResponse({
        items: [{ sessionId: "s1" /* missing startedAt, lastAt, etc. */ }],
        total: 1,
        meta: {
          matchedExtent: null,
          globalCapture: {
            hasCostSamples: false,
            hasTurnBoundaries: false,
            hasCostLog: false,
            costBasis: "computed",
          },
        },
      }),
    );
    await expect(listSessions()).rejects.toMatchObject({
      name: "SessionsResponseShapeError",
    });
  });

  it("throws SessionsResponseShapeError when meta.globalCapture is malformed", async () => {
    installFetch(async () =>
      makeResponse({
        items: [],
        total: 0,
        meta: {
          matchedExtent: null,
          globalCapture: { hasCostSamples: "yes" /* should be boolean */ },
        },
      }),
    );
    await expect(listSessions()).rejects.toMatchObject({
      name: "SessionsResponseShapeError",
    });
  });

  it("throws SessionsResponseShapeError when `total` is not a finite number", async () => {
    installFetch(async () =>
      makeResponse({
        items: [],
        total: "lots" /* should be number */,
        meta: {
          matchedExtent: null,
          globalCapture: {
            hasCostSamples: false,
            hasTurnBoundaries: false,
            hasCostLog: false,
            costBasis: "computed",
          },
        },
      }),
    );
    await expect(listSessions()).rejects.toMatchObject({
      name: "SessionsResponseShapeError",
    });
  });

  it("rejects a partially-shaped matched extent", async () => {
    const body = responseWithItem() as {
      meta: { matchedExtent: { from: string; to?: string } };
    };
    delete body.meta.matchedExtent.to;
    installFetch(async () => makeResponse(body));

    await expect(listSessions()).rejects.toMatchObject({
      name: "SessionsResponseShapeError",
    });
  });

  it.each([
    ["optional branch", { branch: 42 }],
    ["optional numeric", { cacheSavingsComputed: null }],
    ["required numeric", { durationMs: "five minutes" }],
    ["trace point", { trace: [{ turnIndex: 0, cost: "expensive", timestamp: "now" }] }],
  ])("rejects a malformed %s field", async (_label, itemOverrides) => {
    installFetch(async () => makeResponse(responseWithItem(itemOverrides)));

    await expect(listSessions({ include: "trace" })).rejects.toMatchObject({
      name: "SessionsResponseShapeError",
    });
  });
});

// ---------------------------------------------------------------------------
// AbortSignal
// ---------------------------------------------------------------------------

describe("listSessions — AbortSignal threading", () => {
  it("passes the caller's AbortSignal through to fetch", async () => {
    const observed: (AbortSignal | undefined)[] = [];
    installFetch(async (_url, init) => {
      observed.push(init?.signal ?? undefined);
      // Stay pending until the signal aborts — mirrors a slow real endpoint.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });

    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = listSessions({ sort: "costComputed" }, c1.signal).catch(() => "aborted");
    const p2 = listSessions({ sort: "costComputed" }, c2.signal).catch(() => "aborted");

    await Promise.resolve();
    expect(observed).toHaveLength(2);
    expect(observed[0]).toBe(c1.signal);
    expect(observed[1]).toBe(c2.signal);

    // Simulate React Query's supersede path: cancel the older query.
    c1.abort();
    // c2 must still be alive — a different in-flight call should not be
    // collateral damage from an unrelated abort.
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(false);

    // Settle both promises.
    c2.abort();
    await Promise.all([p1, p2]);
  });

  it("rejects with the underlying DOMException when no signal is passed and fetch rejects", async () => {
    // Smoke test: passes the same path with no signal set — fetch still
    // resolves the response normally and the wrapper decodes it.
    installFetch(async () => makeResponse(EMPTY_RESPONSE));
    await expect(listSessions()).resolves.toEqual(EMPTY_RESPONSE);
  });
});
