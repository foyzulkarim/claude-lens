import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiCall, ParseTranscriptResult, TokenUsage } from "../../shared/types.js";
import type { PromptTextRecord, ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import { Store } from "../store/store.js";
import { registerSessionDetailRoute } from "./session-detail.js";

let app: FastifyInstance;
let store: Store;

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    ...overrides,
  };
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: "2026-07-13T00:00:00.000Z",
    model: "claude-sonnet-5",
    usage: usage({ inputTokens: 10 }),
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function batch(calls: ApiCall[], prompts: PromptTextRecord[] = []): ParseTranscriptResult {
  return {
    calls,
    prompts,
    toolResultBytes: [] as ToolResultBytesRecord[],
    compactions: [],
    duplicateCount: 0,
    malformedCount: 0,
  };
}

beforeEach(async () => {
  store = new Store({
    debounceMs: 0,
    onInvalidate: () => {},
    pricer: (u) => u.inputTokens * 0.001,
  });
  app = Fastify({ logger: false });
  registerSessionDetailRoute(app, store, {
    pricer: (u) => u.inputTokens * 0.001,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/sessions/:id — known resource", () => {
  it("returns 200 with the projected response when the session is registered", async () => {
    store.applyRecords(
      "s1",
      batch([call({ sessionId: "s1", messageId: "m1" })], [
        { sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-13T00:00:00.000Z" },
      ]),
    );
    // Force-compute now (debounceMs: 0 still schedules a microtask).
    store.flushAll();
    expect(store.getSession("s1")).toBeDefined();

    const response = await app.inject({ method: "GET", url: "/api/sessions/s1" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.header.sessionId).toBe("s1");
    expect(body.timeline).toHaveLength(1);
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0].turnNumber).toBe(1);
    expect(typeof body.workflow).toBe("object");
    expect(typeof body.tokenFunnel).toBe("object");
    expect(Array.isArray(body.contextComposition)).toBe(true);
    expect(Array.isArray(body.toolMix)).toBe(true);
    expect(body.meta.costBasis).toBe("computed");
  });

  it("returns 200 with empty sections for a known session with no calls", async () => {
    // Seed then reset — `applyRecords` with zero records still registers the
    // session state in the Store, which is what "known" means.
    store.applyRecords("s-empty", batch([]));
    store.resetSession("s-empty");

    const response = await app.inject({ method: "GET", url: "/api/sessions/s-empty" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.timeline).toEqual([]);
    expect(body.turns).toEqual([]);
    expect(body.meta.isEmpty).toBe(true);
  });

  it("ignores unrelated global-filter query parameters (A12)", async () => {
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();
    expect(store.getSession("s1")).toBeDefined();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1?project=alpha&from=2026-07-01T00:00:00.000Z",
    });
    // A12: the detail URL names a resource; silently filtering the
    // addressed session by global filters would surprise call sites.
    expect(response.statusCode).toBe(200);
    expect(response.json().header.sessionId).toBe("s1");
  });
});

describe("GET /api/sessions/:id — unknown session", () => {
  it("returns 404 with the typed error body", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions/does-not-exist" });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body).toEqual({ error: "session not found", sessionId: "does-not-exist" });
  });

  it("URL-encodes the session id without breaking the path", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/non-existent-id",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().sessionId).toBe("non-existent-id");
  });
});

describe("GET /api/sessions/:id — projector wiring", () => {
  it("returns 200 with logical turn grouping (sidechain folds into parent prompt)", async () => {
    const mainCall = call({ sessionId: "s1", messageId: "m1", timestamp: "2026-07-13T00:01:00.000Z" });
    const sideCall = call({
      sessionId: "s1",
      messageId: "m2",
      timestamp: "2026-07-13T00:02:00.000Z",
      isSidechain: true,
    });
    // Prompts own the promptId; calls are chronologically assigned to the
    // latest preceding prompt in the same session. Both calls belong to
    // prompt p1.
    const prompts = [
      { sessionId: "s1", promptId: "p1", text: "do thing", timestamp: "2026-07-13T00:00:00.000Z" },
    ];
    store.applyRecords("s1", batch([mainCall, sideCall], prompts));
    store.flushAll();

    const response = await app.inject({ method: "GET", url: "/api/sessions/s1" });
    const body = response.json();

    // Two derived Turn records (one main, one sidechain) collapse into one
    // logical prompt turn so the page shows one turn number.
    expect(body.turns).toHaveLength(1);
    expect(body.turns[0].hasSidechain).toBe(true);
    expect(body.turns[0].mainCost).toBeGreaterThan(0);
    expect(body.turns[0].sidechainCost).toBeGreaterThan(0);
  });
});
