import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MetricsQuery } from "../../shared/metrics-contract.js";
import { buildApp } from "../app.js";
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import { Store } from "../store/store.js";
import type { ApiCall } from "../../shared/types.js";

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
});
