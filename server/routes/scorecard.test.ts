import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import { buildApp } from "../app.js";
import { buildRuntimeMetadata } from "../runtime.js";
import { Store } from "../store/store.js";

function iso(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): string {
  return new Date(y, mo, d, h, mi, s).toISOString();
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

function record(calls: ApiCall[]) {
  return {
    calls,
    prompts: [],
    toolResultBytes: [],
    compactions: [],
    rawLines: 0,
    skippedLines: 0,
    duplicateCount: 0,
    malformedCount: 0,
  };
}

/**
 * Warmup (c1) -> incremental growth (c2) -> `fillerCount` neutral read-only
 * calls holding the high-water mark -> a prefix bust (last call), mirroring
 * `server/scorecard/engine.test.ts`'s hand-calculated pattern. `cacheCreate5m`
 * on the bust call is what makes the classifier attribute it `prefix-change`
 * (`kind: "prefix-bust"`) instead of the TTL-gap-less `"unknown"` default.
 */
function bustSession(sessionId: string, dayOffset: number, fillerCount = 7): ApiCall[] {
  const calls: ApiCall[] = [
    call({
      sessionId,
      messageId: `${sessionId}-m1`,
      timestamp: iso(2026, 6, 14 + dayOffset, 10, 0),
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 100 },
    }),
    call({
      sessionId,
      messageId: `${sessionId}-m2`,
      timestamp: iso(2026, 6, 14 + dayOffset, 10, 1),
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 100, cacheCreateTokens: 50 },
    }),
  ];
  for (let i = 0; i < fillerCount; i += 1) {
    calls.push(
      call({
        sessionId,
        messageId: `${sessionId}-filler-${i}`,
        timestamp: iso(2026, 6, 14 + dayOffset, 10, 2 + i),
        usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 150, cacheCreateTokens: 0 },
      }),
    );
  }
  calls.push(
    call({
      sessionId,
      messageId: `${sessionId}-bust`,
      timestamp: iso(2026, 6, 14 + dayOffset, 10, 2 + fillerCount),
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      },
    }),
  );
  return calls;
}

let configDir: string;
let app: FastifyInstance;
let store: Store;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "claude-lens-scorecard-route-config-"));
  const metadata = buildRuntimeMetadata();
  store = new Store({ onInvalidate: () => {}, pricer: metadata.pricer, pricing: metadata.pricing });
  app = buildApp({
    store,
    logger: false,
    metadata,
    configPath: join(configDir, "config.json"),
  });
});

afterEach(async () => {
  await app.close();
  await rm(configDir, { recursive: true, force: true });
  store.stop();
});

describe("GET /api/sessions/:id/scorecard", () => {
  it("returns 404 for an unknown session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/does-not-exist/scorecard",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "session not found",
      sessionId: "does-not-exist",
    });
  });

  it("returns a graded state with core + events + evaluatedAt for a gradeable session", async () => {
    const sessionId = "graded-session";
    store.applyRecords(sessionId, record(bustSession(sessionId, 0)));

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/scorecard`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.state).toBe("graded");
    expect(["A", "B", "C", "D", "F"]).toContain(body.grade);
    expect(body.core.sessionId).toBe(sessionId);
    expect(body.core.decomposition).toEqual({ warmup: 100, incremental: 50, rewritten: 120 });
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ kind: "prefix-bust", tokensRewritten: 120 });
    expect(typeof body.events[0].costEstimate).toBe("number");
    expect(body.events[0].costBasis).toBe("computed");
    expect(body.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns no-main-thread-calls for a session with only sidechain calls", async () => {
    const sessionId = "sidechain-only";
    store.applyRecords(
      sessionId,
      record([
        call({
          sessionId,
          messageId: `${sessionId}-m1`,
          isSidechain: true,
          usage: {
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheCreateTokens: 100,
          },
        }),
      ]),
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/scorecard`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("no-main-thread-calls");
  });

  it("returns too-short for a session below the default floor", async () => {
    const sessionId = "too-short-session";
    store.applyRecords(sessionId, record(bustSession(sessionId, 0, 0).slice(0, 3)));

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/scorecard`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "too-short", floorCalls: 10 });
  });

  it("returns no-scoreable-creation for a read-only session at or above the floor", async () => {
    const sessionId = "no-scoreable-session";
    const calls = Array.from({ length: 10 }, (_, i) =>
      call({
        sessionId,
        messageId: `${sessionId}-m${i}`,
        timestamp: iso(2026, 6, 14, 10, i),
        usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
    );
    store.applyRecords(sessionId, record(calls));

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/scorecard`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("no-scoreable-creation");
  });

  it("changes the grade boundary when the configured floor changes, without a restart", async () => {
    const sessionId = "floor-boundary-session";
    store.applyRecords(sessionId, record(bustSession(sessionId, 0)));

    const graded = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/scorecard` });
    expect(graded.json().state).toBe("graded");

    const raise = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: null, scorecardThresholds: { floorCalls: 11 } },
    });
    expect(raise.statusCode).toBe(200);

    const tooShort = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/scorecard`,
    });
    expect(tooShort.json()).toMatchObject({ state: "too-short", floorCalls: 11 });

    const lower = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: null, scorecardThresholds: { floorCalls: 5 } },
    });
    expect(lower.statusCode).toBe(200);

    const gradedAgain = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/scorecard`,
    });
    expect(gradedAgain.json().state).toBe("graded");
  });

  it("prices with post-edit rates via live Store pricing, not a startup closure", async () => {
    const sessionId = "repriced-session";
    store.applyRecords(sessionId, record(bustSession(sessionId, 0)));

    const before = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/scorecard` });
    const beforeCost = before.json().events[0].costEstimate as number;

    store.updatePricing({
      pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 10, cacheCreate: 20 } },
    });

    const after = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}/scorecard` });
    const afterCost = after.json().events[0].costEstimate as number;

    expect(afterCost).not.toBe(beforeCost);
    expect(afterCost).toBeCloseTo((120 * (20 - 10)) / 1_000_000, 6);
  });
});

describe("GET /api/dashboard/biggest-lever", () => {
  const range = (from: string, to: string) => `from=${from}&to=${to}`;

  it("returns 400 when from/to are missing or malformed or reversed", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/dashboard/biggest-lever" });
    expect(missing.statusCode).toBe(400);

    const malformed = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range("not-a-date", iso(2026, 6, 20))}`,
    });
    expect(malformed.statusCode).toBe(400);

    const reversed = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range(iso(2026, 6, 20), iso(2026, 6, 10))}`,
    });
    expect(reversed.statusCode).toBe(400);
  });

  it("selects the largest in-range event and re-selects when the range changes", async () => {
    const small = "small-session";
    const big = "big-session";
    store.applyRecords(small, record(bustSession(small, 0)));
    store.applyRecords(big, record(bustSession(big, 1)));

    const wideRange = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range(iso(2026, 6, 14), iso(2026, 6, 16))}`,
    });
    expect(wideRange.statusCode).toBe(200);
    const wideBody = wideRange.json();
    expect(wideBody.state).toBe("event");

    const narrowedToSmallOnly = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range(iso(2026, 6, 14), iso(2026, 6, 14, 23))}`,
    });
    const narrowedBody = narrowedToSmallOnly.json();
    expect(narrowedBody.state).toBe("event");
    expect(narrowedBody.sessionId).toBe(small);
  });

  it("filters by project", async () => {
    const inScope = "in-scope-session";
    const otherProject = "other-project-session";
    store.applyRecords(inScope, record(bustSession(inScope, 0)));
    store.applyRecords(
      otherProject,
      record(bustSession(otherProject, 0).map((c) => ({ ...c, cwd: "/repo/beta" }))),
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range(iso(2026, 6, 14), iso(2026, 6, 15))}&project=/repo/alpha`,
    });
    const body = response.json();
    expect(body.state).toBe("event");
    expect(body.sessionId).toBe(inScope);
  });

  it("returns the healthy variant when the period has creation but no waste", async () => {
    const sessionId = "healthy-session";
    store.applyRecords(sessionId, record(bustSession(sessionId, 0, 0).slice(0, 2)));

    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range(iso(2026, 6, 14), iso(2026, 6, 15))}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "healthy",
      firstWriteTokens: 150,
      totalCreationTokens: 150,
    });
  });

  it("returns the no-cache-activity variant when the period has zero creation", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/dashboard/biggest-lever?${range(iso(2026, 6, 14), iso(2026, 6, 15))}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      state: "no-cache-activity",
      firstWriteTokens: 0,
      totalCreationTokens: 0,
      firstWriteShare: null,
    });
  });
});
