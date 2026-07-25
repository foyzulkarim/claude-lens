import { performance } from "node:perf_hooks";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetricsQuery } from "../../shared/metrics-contract.js";
import type { ApiCall } from "../../shared/types.js";
import { buildApp } from "../app.js";
import * as engine from "../metrics/engine.js";
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import { Store } from "../store/store.js";
import { parseMetricsQuery } from "./metrics.js";

// Same local-Date convention as metrics/engine.test.ts — grain.ts buckets by
// *local* calendar day, so hardcoded "...Z" timestamps would make bucket
// assignment depend on the machine running the test.
function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: iso(2026, 6, 14, 10, 0),
    model: "claude-sonnet-5",
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

describe("POST /api/metrics", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    store = new Store({ onInvalidate: () => {} });
    // logger: false — avoid a pino-pretty worker + its process exit listener
    // per test (this beforeEach builds a fresh app for every case).
    app = buildApp({ store, logger: false });
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("returns Series[] computed from fixture data in the store", async () => {
    store.applyRecords("s1", {
      calls: [call({ uuid: "c1", timestamp: iso(2026, 6, 14, 10, 0) })],
      prompts: [],
      toolResultBytes: [],
      compactions: [],
      rawLines: 0,
      skippedLines: 0,
      duplicateCount: 0,
      malformedCount: 0,
    });

    const query: MetricsQuery = {
      measures: ["costComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    };

    const response = await app.inject({ method: "POST", url: "/api/metrics", payload: query });

    expect(response.statusCode).toBe(200);
    const series = response.json();
    const rate = DEFAULT_PRICING_TABLE["claude-sonnet-5"];
    const expectedCost = (1000 * rate.input + 100 * rate.output) / 1_000_000;

    // One series (single "all" group, dimensions has no breakdown dim), one
    // point per day bucket across the 3-day range — only the Jul 14 bucket
    // has the call's cost, the other two are the honest zero.
    expect(series).toHaveLength(1);
    expect(series[0].measure).toBe("costComputed");
    expect(series[0].points).toHaveLength(3);
    const nonZero = series[0].points.filter((p: { value: number }) => p.value !== 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0].value).toBeCloseTo(expectedCost);
  });

  it("returns the honest zero series against an empty store, not an error", async () => {
    const query: MetricsQuery = {
      measures: ["apiCalls"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    };

    const response = await app.inject({ method: "POST", url: "/api/metrics", payload: query });

    expect(response.statusCode).toBe(200);
    const series = response.json();
    // dimensions: [] has no "time" breakdown, so this is a single un-bucketed
    // point (buckets = [null]) — not the 3 day-buckets of the happy-path test.
    expect(series).toHaveLength(1);
    expect(series[0].points).toHaveLength(1);
    expect(series[0].points[0].value).toBe(0);
  });

  function baseQuery(): MetricsQuery {
    return {
      measures: ["apiCalls"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    };
  }

  it("400s on a malformed body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { measures: ["not-a-real-measure"] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
  });

  it("400s on a non-object body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("nope"),
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an unknown dimension", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), dimensions: ["not-a-real-dim"] },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an invalid grain", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), grain: "century" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on a missing range", async () => {
    const query = baseQuery() as unknown as Record<string, unknown>;
    delete query.range;
    const response = await app.inject({ method: "POST", url: "/api/metrics", payload: query });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an unparseable range date instead of silently admitting all data", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), range: { from: "not-a-date", to: iso(2026, 6, 15) } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on distribution mode with a bad distributionEntity", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), mode: "distribution", distributionEntity: "bogus" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on distribution mode with distributionEntity omitted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), mode: "distribution" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on a filters value that isn't an array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), filters: { model: "opus" } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an unknown filters key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), filters: { "not-a-real-dim": ["x"] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("accepts a valid filters object and returns 200", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: { ...baseQuery(), filters: { model: ["claude-sonnet-5"] } },
    });
    expect(response.statusCode).toBe(200);
  });

  it("accepts the totalTokens × turns scatter preset and returns its discriminated response", async () => {
    store.applyRecords("s1", {
      calls: [call({ uuid: "scatter-call" })],
      prompts: [],
      toolResultBytes: [],
      compactions: [],
      rawLines: 0,
      skippedLines: 0,
      duplicateCount: 0,
      malformedCount: 0,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: {
        measures: ["totalTokens", "turns"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 13), to: iso(2026, 6, 15) },
        mode: "scatter",
        entity: "session",
        xMeasure: "totalTokens",
        yMeasure: "turns",
        sessionPopulation: {},
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "scatter",
      xMeasure: "totalTokens",
      yMeasure: "turns",
    });
  });

  it("rejects malformed scatter fields before engine dispatch", () => {
    expect(
      parseMetricsQuery({
        measures: ["totalTokens", "turns"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 13), to: iso(2026, 6, 15) },
        mode: "scatter",
        entity: "session",
        xMeasure: "not-a-measure",
        yMeasure: "turns",
        sessionPopulation: {},
      }),
    ).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// ARCH-119 T2: per-query instrumentation — Server-Timing header + structured
// log line. The response body/status is unchanged (guarded by the suite
// above); these tests cover the additive header + log seam only.
// ---------------------------------------------------------------------------

describe("POST /api/metrics — instrumentation (ARCH-119)", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store({ onInvalidate: () => {} });
    store.applyRecords("s1", {
      calls: [call({ uuid: "c1", timestamp: iso(2026, 6, 14, 10, 0) })],
      prompts: [],
      toolResultBytes: [],
      compactions: [],
      rawLines: 0,
      skippedLines: 0,
      duplicateCount: 0,
      malformedCount: 0,
    });
  });

  afterEach(() => {
    store.stop();
    vi.restoreAllMocks();
  });

  const seriesPayload = {
    measures: ["apiCalls"],
    dimensions: ["time"],
    grain: "day",
    range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
  };

  const scatterPayload = {
    measures: ["totalTokens", "turns"],
    dimensions: [],
    grain: "day",
    range: { from: iso(2026, 6, 13), to: iso(2026, 6, 15) },
    mode: "scatter",
    entity: "session",
    xMeasure: "totalTokens",
    yMeasure: "turns",
    sessionPopulation: {},
  };

  /** Build an app whose pino logger writes JSON lines into a captured array. */
  function buildCapturingApp() {
    const logs: Record<string, unknown>[] = [];
    const stream = {
      write: (line: string) => {
        logs.push(JSON.parse(line));
      },
    };
    const app = buildApp({ store, logger: { level: "info", stream } });
    return { app, logs };
  }

  it("sets a Server-Timing header on a series response", async () => {
    const app = buildApp({ store, logger: false });
    try {
      const res = await app.inject({ method: "POST", url: "/api/metrics", payload: seriesPayload });
      expect(res.statusCode).toBe(200);
      expect(res.headers["server-timing"]).toContain("engine;dur=");
    } finally {
      await app.close();
    }
  });

  it("sets a Server-Timing header on a scatter response (uniform across modes)", async () => {
    const app = buildApp({ store, logger: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/metrics",
        payload: scatterPayload,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["server-timing"]).toContain("engine;dur=");
    } finally {
      await app.close();
    }
  });

  it("emits neither a Server-Timing header nor a query log line on a 400", async () => {
    // Both halves matter: validation returns before the probe exists, so
    // moving the log emission above that return must fail here.
    const { app, logs } = buildCapturingApp();
    let res: Awaited<ReturnType<typeof app.inject>>;
    try {
      res = await app.inject({
        method: "POST",
        url: "/api/metrics",
        payload: { measures: ["not-a-measure"] },
      });
    } finally {
      await app.close();
    }
    expect(res.statusCode).toBe(400);
    expect(res.headers["server-timing"]).toBeUndefined();
    expect(logs.some((l) => l.msg === "metrics query")).toBe(false);
  });

  it("logs one structured info line with query shape and timing breakdown", async () => {
    const { app, logs } = buildCapturingApp();
    let res: Awaited<ReturnType<typeof app.inject>>;
    try {
      res = await app.inject({ method: "POST", url: "/api/metrics", payload: seriesPayload });
    } finally {
      await app.close();
    }

    // Exactly one — a duplicate emission (both branches, or an added hook) is
    // a log-volume regression this signal exists to bound.
    const lines = logs.filter((l) => l.msg === "metrics query");
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatchObject({
      measures: ["apiCalls"],
      dimensions: ["time"],
      grain: "day",
      mode: "series",
    });
    for (const key of [
      "rangeDays",
      "inputMs",
      "filterGroupMs",
      "scopeMs",
      "groupCount",
      "bucketCount",
      "computeMs",
      "engineMs",
      "totalMs",
    ]) {
      expect(line).toHaveProperty(key);
    }
    expect(line?.level).toBe(30); // pino info
    // The header carries the same phases, and the log's numbers are rounded
    // the same way — so a DevTools timing and a log line are comparable.
    expect(res.headers["server-timing"]).toMatch(
      /^input;dur=[\d.]+, filter;dur=[\d.]+, scope;dur=[\d.]+, compute;dur=[\d.]+, engine;dur=[\d.]+, total;dur=[\d.]+$/,
    );
  });

  it("logs the breakdown for distribution and scatter modes too", async () => {
    const distributionPayload = {
      measures: ["apiCalls"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
      mode: "distribution",
      distributionEntity: "session",
    };

    const { app, logs } = buildCapturingApp();
    try {
      await app.inject({ method: "POST", url: "/api/metrics", payload: distributionPayload });
      await app.inject({ method: "POST", url: "/api/metrics", payload: scatterPayload });
    } finally {
      await app.close();
    }

    const lines = logs.filter((l) => l.msg === "metrics query");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ mode: "distribution", bucketCount: 0 });
    expect(lines[1]).toMatchObject({ mode: "scatter", bucketCount: 0 });
    for (const line of lines) {
      expect(line).toHaveProperty("scopeMs");
      expect(line).toHaveProperty("engineMs");
    }
  });

  it("still emits the header and log line when the engine throws", async () => {
    // The pathological query is the one worth diagnosing — it must not reach
    // the error handler untraced.
    const boom = new Error("engine exploded");
    vi.spyOn(engine, "metrics").mockImplementation(() => {
      throw boom;
    });

    const { app, logs } = buildCapturingApp();
    let res: Awaited<ReturnType<typeof app.inject>>;
    try {
      res = await app.inject({ method: "POST", url: "/api/metrics", payload: seriesPayload });
    } finally {
      await app.close();
    }

    expect(res.statusCode).toBe(500);
    expect(res.headers["server-timing"]).toContain("engine;dur=");
    const line = logs.find((l) => l.msg === "metrics query");
    expect(line).toMatchObject({ mode: "series", errored: true });
  });

  it("counts store materialization in inputMs, so a slow store escalates to warn", async () => {
    // Every performance.now() reading advances 300ms. The first two readings
    // bracket the store reads + gate batch, so inputMs alone clears the 250ms
    // threshold — pinning that the window opens before the engine call rather
    // than at it.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 300));

    const { app, logs } = buildCapturingApp();
    try {
      await app.inject({ method: "POST", url: "/api/metrics", payload: seriesPayload });
    } finally {
      await app.close();
    }

    const line = logs.find((l) => l.msg === "metrics query");
    expect(line?.inputMs).toBe(300);
    expect(line?.level).toBe(40); // pino warn
  });

  it("escalates to a warn line when the query exceeds the slow threshold", async () => {
    // Force totalMs >= SLOW_QUERY_MS deterministically: every performance.now()
    // call advances 1s, so the route's (after - before) delta is well over
    // the 250ms threshold regardless of real timing.
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1000));

    const { app, logs } = buildCapturingApp();
    try {
      await app.inject({ method: "POST", url: "/api/metrics", payload: seriesPayload });
    } finally {
      await app.close();
    }

    const line = logs.find((l) => l.msg === "metrics query");
    expect(line?.level).toBe(40); // pino warn
  });
});
