import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MetricsQuery,
  ScatterMetricsQuery,
  ScatterMetricsResult,
  Series,
} from "../../../shared/metrics-contract.js";
import { MetricsApiError, postMetrics, postScatterMetrics } from "./metrics.js";

const EMPTY_SERIES: Series[] = [];

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

// ---------------------------------------------------------------------------
// postMetrics — aggregate wrapper (existing contract preserved)
// ---------------------------------------------------------------------------

describe("postMetrics — aggregate wrapper", () => {
  const aggregateQuery: MetricsQuery = {
    measures: ["costComputed"],
    dimensions: ["time"],
    grain: "day",
    range: { from: "2026-07-01T00:00:00Z", to: "2026-07-10T00:00:00Z" },
  };

  it("serializes the query as JSON and resolves to the typed Series[]", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    installFetch(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init?.body ?? "null"));
      return makeResponse(EMPTY_SERIES);
    });
    await postMetrics(aggregateQuery);
    expect(capturedUrl).toBe("/api/metrics");
    expect(capturedBody).toEqual(aggregateQuery);
  });

  it("throws plain Error on non-2xx (preserves existing contract — no MetricsApiError widening)", async () => {
    installFetch(async () => makeResponse({ error: "measures must be …" }, { status: 400 }));
    let caught: unknown;
    try {
      await postMetrics({ ...aggregateQuery, measures: ["bogus" as never] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(MetricsApiError);
    expect((caught as Error).message).toContain("POST /api/metrics failed (400)");
  });

  it("throws when the 2xx body is not an array (shape guard, no widening)", async () => {
    installFetch(async () => makeResponse({ mode: "scatter" }));
    await expect(postMetrics(aggregateQuery)).rejects.toMatchObject({
      message: expect.stringContaining("non-array response"),
    });
  });
});

// ---------------------------------------------------------------------------
// postScatterMetrics — new wrapper, separately guarded
// ---------------------------------------------------------------------------

function baseScatterQuery(): ScatterMetricsQuery {
  return {
    mode: "scatter",
    entity: "session",
    measures: ["costComputed"],
    dimensions: [],
    grain: "day",
    range: { from: "2026-07-01T00:00:00Z", to: "2026-07-10T00:00:00Z" },
    xMeasure: "costComputed",
    yMeasure: "wallMinutes",
    sessionPopulation: {},
  };
}

function emptyScatterResult(): ScatterMetricsResult {
  return {
    mode: "scatter",
    entity: "session",
    xMeasure: "costComputed",
    yMeasure: "wallMinutes",
    points: [],
    regression: null,
    population: {
      matched: 0,
      eligible: 0,
      returned: 0,
      excludedMissingMeasures: 0,
      sampled: false,
    },
  };
}

describe("postScatterMetrics — body & URL contract", () => {
  it("POSTs to /api/metrics with the scatter query as JSON", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    installFetch(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init?.body ?? "null"));
      return makeResponse(emptyScatterResult());
    });
    await postScatterMetrics(baseScatterQuery());
    expect(capturedUrl).toBe("/api/metrics");
    expect(capturedBody).toMatchObject({ mode: "scatter", entity: "session" });
  });

  it("passes the AbortSignal through to fetch", async () => {
    const observed: (AbortSignal | undefined)[] = [];
    installFetch(async (_url, init) => {
      observed.push(init?.signal ?? undefined);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const controller = new AbortController();
    const promise = postScatterMetrics(baseScatterQuery(), controller.signal).catch(
      () => "aborted",
    );
    await Promise.resolve();
    expect(observed[0]).toBe(controller.signal);
    controller.abort();
    await promise;
  });
});

describe("postScatterMetrics — error path", () => {
  it("wraps a 400 as MetricsApiError with the validator message", async () => {
    installFetch(async () =>
      makeResponse({ error: "xMeasure must be a known Measure value" }, { status: 400 }),
    );
    let caught: unknown;
    try {
      await postScatterMetrics(baseScatterQuery());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MetricsApiError);
    const err = caught as MetricsApiError;
    expect(err.status).toBe(400);
    expect(err.validation).toBe("xMeasure must be a known Measure value");
    expect(err.message).toContain("POST /api/metrics failed (400)");
  });

  it("surfaces a 5xx with null validation when no body is returned", async () => {
    installFetch(async () => new Response(null, { status: 500 }));
    await expect(postScatterMetrics(baseScatterQuery())).rejects.toMatchObject({
      name: "MetricsApiError",
      status: 500,
      validation: null,
    });
  });
});

describe("postScatterMetrics — response shape guard", () => {
  it("throws ScatterResponseShapeError when mode/entity are wrong", async () => {
    installFetch(async () => makeResponse({ ...emptyScatterResult(), mode: "series" }));
    await expect(postScatterMetrics(baseScatterQuery())).rejects.toMatchObject({
      name: "ScatterResponseShapeError",
    });
  });

  it("throws ScatterResponseShapeError when a point is malformed", async () => {
    installFetch(async () =>
      makeResponse({
        ...emptyScatterResult(),
        points: [{ sessionId: "s1", x: "lots", y: 1 }],
      }),
    );
    await expect(postScatterMetrics(baseScatterQuery())).rejects.toMatchObject({
      name: "ScatterResponseShapeError",
    });
  });

  it("throws when points exceed the 500-point contract cap", async () => {
    const points = Array.from({ length: 501 }, (_, i) => ({
      sessionId: `s${i}`,
      x: i,
      y: i,
    }));
    installFetch(async () => makeResponse({ ...emptyScatterResult(), points }));
    await expect(postScatterMetrics(baseScatterQuery())).rejects.toMatchObject({
      name: "ScatterResponseShapeError",
      message: expect.stringContaining("at most 500"),
    });
  });

  it("throws when regression is a non-null invalid shape", async () => {
    installFetch(async () =>
      makeResponse({
        ...emptyScatterResult(),
        regression: { slope: "infinity" },
      }),
    );
    await expect(postScatterMetrics(baseScatterQuery())).rejects.toMatchObject({
      name: "ScatterResponseShapeError",
    });
  });

  it("accepts a valid scatter response", async () => {
    installFetch(async () => makeResponse(emptyScatterResult()));
    const result = await postScatterMetrics(baseScatterQuery());
    expect(result.mode).toBe("scatter");
    expect(result.points).toEqual([]);
    expect(result.regression).toBeNull();
  });
});
