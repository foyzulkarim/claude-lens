import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import type { PromptTextRecord } from "../ingest/parse-transcript.js";
import { buildApp } from "../app.js";
import { Store } from "../store/store.js";

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
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function prompt(overrides: Partial<PromptTextRecord> & { promptId: string }): PromptTextRecord {
  return {
    sessionId: "s1",
    text: "hello",
    timestamp: iso(2026, 5, 14, 10, 0),
    ...overrides,
  };
}

describe("GET /api/search-index (#P4-3)", () => {
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

  it("returns 200 with an empty payload when no sessions exist", async () => {
    const response = await app.inject({ method: "GET", url: "/api/search-index" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ prompts: [], version: 1 });
  });

  it("returns one doc per prompt with resolved turnNumber", async () => {
    store.applyRecords("s1", {
      calls: [call({ uuid: "u1", messageId: "m1" })],
      prompts: [prompt({ promptId: "p1", text: "first prompt" })],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    const response = await app.inject({ method: "GET", url: "/api/search-index" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      prompts: Array<{ id: string; turnNumber: number }>;
      version: number;
    };
    expect(body.prompts).toHaveLength(1);
    expect(body.prompts[0]?.id).toBe("s1:p1");
    expect(body.prompts[0]?.turnNumber).toBe(1);
    expect(body.version).toBeGreaterThanOrEqual(1);
  });

  it("returns the prompts of multiple sessions sorted by timestamp", async () => {
    store.applyRecords("s1", {
      calls: [
        call({ uuid: "u1", messageId: "m1", sessionId: "s1", timestamp: iso(2026, 5, 14, 11, 0) }),
      ],
      prompts: [
        prompt({
          sessionId: "s1",
          promptId: "p1",
          timestamp: iso(2026, 5, 14, 11, 0),
          text: "later",
        }),
      ],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    store.applyRecords("s2", {
      calls: [
        call({ uuid: "u2", messageId: "m2", sessionId: "s2", timestamp: iso(2026, 5, 14, 10, 0) }),
      ],
      prompts: [
        prompt({
          sessionId: "s2",
          promptId: "p1",
          timestamp: iso(2026, 5, 14, 10, 0),
          text: "earlier",
        }),
      ],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    const response = await app.inject({ method: "GET", url: "/api/search-index" });
    const body = response.json() as { prompts: Array<{ id: string }> };
    expect(body.prompts.map((p) => p.id)).toEqual(["s2:p1", "s1:p1"]);
  });

  it("bumps the version counter on each call", async () => {
    const a = await app.inject({ method: "GET", url: "/api/search-index" });
    const b = await app.inject({ method: "GET", url: "/api/search-index" });
    const versionA = (a.json() as { version: number }).version;
    const versionB = (b.json() as { version: number }).version;
    expect(versionB).toBe(versionA + 1);
  });
});
