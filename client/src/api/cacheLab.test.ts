import { afterEach, describe, expect, it, vi } from "vitest";
import { CacheLabApiError, CacheLabResponseShapeError, postCacheLab } from "./cacheLab.js";

const EMPTY_ANALYSIS = {
  economics: {
    actualCost: 0,
    cacheSavings: 0,
    uncachedCost: 0,
    bustLoss: 0,
    netBenefit: 0,
    bustCount: 0,
    netNegativeSessionCount: 0,
    pricingComplete: true,
  },
  attribution: {
    ttlLapseCount: 0,
    prefixChangeCount: 0,
    unknownCount: 0,
    verdict: "no-events" as const,
  },
  ttlMix: { ephemeral5mTokens: 0, ephemeral1hTokens: 0, unknownTokens: 0 },
  baseline: { grain: "day" as const, points: [] },
  invalidationCost: { grain: "day" as const, points: [] },
  gallery: { items: [], total: 0, truncated: false },
  contextGrowth: { curves: [], total: 0, truncated: false, basis: "token-estimated" as const },
};

function makeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

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

describe("postCacheLab — request shape", () => {
  it("POSTs the query as JSON to /api/cache-lab with the right method + content type", async () => {
    let captured:
      | { url: string; method: string; headers: Record<string, string>; body: string }
      | undefined;
    installFetch(async (url, init) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init?.headers ?? {})) {
        headers[k] = String(v);
      }
      captured = {
        url,
        method: init?.method ?? "",
        headers,
        body: typeof init?.body === "string" ? init.body : "",
      };
      return makeResponse(EMPTY_ANALYSIS);
    });

    await postCacheLab({
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.000Z" },
      grain: "day",
    });

    expect(captured?.url).toBe("/api/cache-lab");
    expect(captured?.method).toBe("POST");
    expect(captured?.headers["Content-Type"] ?? captured?.headers["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.000Z" },
      grain: "day",
    });
  });

  it("forwards the AbortSignal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    installFetch(async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return makeResponse(EMPTY_ANALYSIS);
    });
    const controller = new AbortController();
    await postCacheLab(
      { range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" }, grain: "day" },
      controller.signal,
    );
    expect(capturedSignal).toBe(controller.signal);
  });
});

describe("postCacheLab — error handling", () => {
  it("surfaces the server's error message on non-2xx via CacheLabApiError", async () => {
    installFetch(async () =>
      makeResponse({ error: "grain must be one of hour, day, week, month" }, { status: 400 }),
    );
    await expect(
      postCacheLab({
        range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
        grain: "century" as never,
      }),
    ).rejects.toMatchObject({
      name: "CacheLabApiError",
      status: 400,
      validation: "grain must be one of hour, day, week, month",
    });
  });

  it("rejects malformed JSON as CacheLabApiError, not a runtime crash", async () => {
    installFetch(
      async () =>
        new Response("not-json", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );
    await expect(
      postCacheLab({
        range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
        grain: "day",
      }),
    ).rejects.toBeInstanceOf(CacheLabApiError);
  });

  it("rejects a 2xx response missing required sections as CacheLabResponseShapeError", async () => {
    installFetch(async () => makeResponse({ economics: {} })); // missing 6 of 7 sections
    await expect(
      postCacheLab({
        range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
        grain: "day",
      }),
    ).rejects.toBeInstanceOf(CacheLabResponseShapeError);
  });
});
