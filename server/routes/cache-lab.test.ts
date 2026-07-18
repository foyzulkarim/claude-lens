import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import { Store } from "../store/store.js";
import type { ApiCall } from "../../shared/types.js";

function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: iso(2026, 5, 14, 10, 0),
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

function baseQuery(): Record<string, unknown> {
  return {
    range: { from: iso(2026, 5, 13, 0, 0), to: iso(2026, 5, 15, 23, 59) },
    grain: "day",
  };
}

describe("POST /api/cache-lab", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    store = new Store({ onInvalidate: () => {} });
    app = buildApp({ store, logger: false });
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("returns the typed CacheLabAnalysis for a valid query", async () => {
    store.applyRecords("s1", {
      calls: [
        call({
          uuid: "c1",
          messageId: "c1",
          timestamp: iso(2026, 5, 14, 10, 0),
          usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
        }),
      ],
      prompts: [],
      toolResultBytes: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: baseQuery(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      economics: expect.objectContaining({ pricingComplete: true, bustCount: 0 }),
      // Single first-call spike → unknown attribution → "insufficient-evidence"
      // (only-unknown is not no-events; one event was classified, it just
      // wasn't TTL- or prefix-attributable).
      attribution: expect.objectContaining({ verdict: "insufficient-evidence", unknownCount: 1 }),
      ttlMix: expect.objectContaining({
        ephemeral5mTokens: 12_000,
        ephemeral1hTokens: 0,
        unknownTokens: 0,
      }),
      baseline: expect.objectContaining({ grain: "day" }),
      invalidationCost: expect.objectContaining({ grain: "day" }),
      // The spike IS in the gallery (first-call is a labeled event with
      // an evidence row) — total=1, items=[{...}], truncated=false.
      gallery: expect.objectContaining({ total: 1, truncated: false }),
      contextGrowth: expect.objectContaining({ basis: "token-estimated" }),
    });
  });

  it("400s on a non-object body", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("nope"),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
  });

  it("400s on a missing range", async () => {
    const query = baseQuery();
    delete (query as { range?: unknown }).range;
    const response = await app.inject({ method: "POST", url: "/api/cache-lab", payload: query });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an unparseable range date", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: { ...baseQuery(), range: { from: "not-a-date", to: iso(2026, 5, 15) } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on a reversed range", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: {
        ...baseQuery(),
        range: { from: iso(2026, 5, 15), to: iso(2026, 5, 13) },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an unknown grain", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: { ...baseQuery(), grain: "century" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an unknown filter key", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: { ...baseQuery(), filters: { "not-a-real-dim": ["x"] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on an empty filter array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: { ...baseQuery(), filters: { model: [] } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("400s on a non-array filter value", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: { ...baseQuery(), filters: { model: "opus" } },
    });
    expect(response.statusCode).toBe(400);
  });

  it("uses the injected runtime pricing table rather than the module default", async () => {
    // H-risk seam: same fixture priced under a different table must
    // produce different dollar values. Build a custom table with a
    // dramatically lower cacheRead rate so cacheSavings balloon vs.
    // the default.
    const customPricing = {
      ...DEFAULT_PRICING_TABLE,
      "claude-sonnet-5": {
        ...DEFAULT_PRICING_TABLE["claude-sonnet-5"]!,
        cacheRead: 0.05, // 10x cheaper than default 0.5 → larger savings
      },
    };

    const customStore = new Store({ onInvalidate: () => {} });
    const customApp = buildApp({
      store: customStore,
      logger: false,
      metadata: { pricing: customPricing, pricer: () => 0, contextResolver: () => null },
    });
    customStore.applyRecords("s1", {
      calls: [
        call({
          uuid: "c1",
          messageId: "c1",
          timestamp: iso(2026, 5, 14, 10, 0),
          usage: { ...call().usage, cacheCreateTokens: 0, cacheReadTokens: 1_000_000 },
        }),
      ],
      prompts: [],
      toolResultBytes: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    const customResponse = await customApp.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: baseQuery(),
    });
    expect(customResponse.statusCode).toBe(200);
    const customBody = customResponse.json();

    // Repeat with the default app to compare.
    const defaultBody = (
      await app.inject({
        method: "POST",
        url: "/api/cache-lab",
        payload: baseQuery(),
      })
    ).json();

    // Custom (low cacheRead → high savings) should exceed default.
    expect(customBody.economics.cacheSavings).toBeGreaterThan(defaultBody.economics.cacheSavings);

    customStore.stop();
    await customApp.close();
  });

  it("takes one Store snapshot per request — no per-event lookups", async () => {
    // Spy on listCalls/listTurns/listSessions to confirm each is
    // invoked exactly once during a single request.
    let callsReads = 0;
    let turnsReads = 0;
    let sessionsReads = 0;
    const spyStore = new Store({
      onInvalidate: () => {},
      pricer: () => 0,
      pricing: DEFAULT_PRICING_TABLE,
    });
    const originalListCalls = spyStore.listCalls.bind(spyStore);
    const originalListTurns = spyStore.listTurns.bind(spyStore);
    const originalListSessions = spyStore.listSessions.bind(spyStore);
    spyStore.listCalls = () => {
      callsReads++;
      return originalListCalls();
    };
    spyStore.listTurns = () => {
      turnsReads++;
      return originalListTurns();
    };
    spyStore.listSessions = () => {
      sessionsReads++;
      return originalListSessions();
    };
    const spyApp = buildApp({ store: spyStore, logger: false });
    spyStore.applyRecords("s1", {
      calls: [
        call({
          uuid: "c1",
          messageId: "c1",
          usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
        }),
      ],
      prompts: [],
      toolResultBytes: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    const before = callsReads + turnsReads + sessionsReads;
    await spyApp.inject({ method: "POST", url: "/api/cache-lab", payload: baseQuery() });
    const after = callsReads + turnsReads + sessionsReads;

    expect(after - before).toBe(3); // one read of each list per request

    spyStore.stop();
    await spyApp.close();
  });

  it("returns 200 with token/null economics when a scoped model is unpriced", async () => {
    // ARCH §A5: a price-incomplete request still returns 200 — the
    // page renders the token panels and an explicit unpriced state
    // for dollar fields, no 5xx, no fabricated zero.
    store.applyRecords("s1", {
      calls: [
        call({
          uuid: "c1",
          sessionId: "s1",
          messageId: "c1",
          timestamp: iso(2026, 5, 14, 10, 0),
          model: "claude-sonnet-5",
          usage: { ...call().usage, cacheCreateTokens: 100, cacheCreate5m: 100 },
        }),
        call({
          uuid: "c2",
          sessionId: "s1",
          messageId: "c2",
          timestamp: iso(2026, 5, 14, 11, 0),
          model: "claude-mystery-future-model",
          usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
        }),
      ],
      prompts: [],
      toolResultBytes: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/cache-lab",
      payload: baseQuery(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.economics.pricingComplete).toBe(false);
    expect(body.economics.actualCost).toBeNull();
    expect(body.economics.cacheSavings).toBeNull();
    // bustCount survives even with unpriced model (it's a count, not a
    // dollar value).
    expect(body.economics.bustCount).toBeGreaterThan(0);
    // TTL tokens still computed.
    expect(body.ttlMix.ephemeral5mTokens).toBeGreaterThan(0);
  });

  it("preserves /api/ping and the 404 fallback when registered alongside other routes", async () => {
    // The new route must not regress existing endpoints or the SPA
    // fallback behavior.
    const ping = await app.inject({ method: "GET", url: "/api/ping" });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual({ ok: true });

    const missing = await app.inject({ method: "GET", url: "/api/does-not-exist" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toHaveProperty("error", "not found");
  });
});
