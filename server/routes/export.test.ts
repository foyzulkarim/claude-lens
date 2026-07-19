import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import { buildApp } from "../app.js";
import type { PromptTextRecord } from "../ingest/parse-transcript.js";
import { buildRuntimeMetadata } from "../runtime.js";
import { Store } from "../store/store.js";

// Same local-Date convention as routes/sessions.test.ts.
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

function prompt(
  sessionId: string,
  promptId: string,
  text: string,
  beforeTs: string,
): PromptTextRecord {
  const t = new Date(Date.parse(beforeTs) - 60_000).toISOString();
  return { sessionId, promptId, text, timestamp: t };
}

interface BuiltApp {
  app: FastifyInstance;
  store: Store;
}

function buildTestApp(): BuiltApp {
  const metadata = buildRuntimeMetadata();
  const store = new Store({
    onInvalidate: () => {},
    pricer: metadata.pricer,
    pricing: metadata.pricing,
  });
  const app = buildApp({ store, logger: false, metadata });
  return { app, store };
}

function addSession(
  store: Store,
  args: {
    sessionId: string;
    timestamp: string;
    model?: string;
    project?: string;
    branch?: string;
  },
): void {
  const ts = args.timestamp;
  const promptId = `p-${args.sessionId}`;
  store.applyRecords(args.sessionId, {
    calls: [
      call({
        sessionId: args.sessionId,
        messageId: `m-${args.sessionId}-1`,
        timestamp: ts,
        model: args.model ?? "claude-sonnet-5",
        cwd: args.project ?? "/repo/alpha",
        gitBranch: args.branch ?? "main",
      }),
    ],
    prompts: [prompt(args.sessionId, promptId, "hi", ts)],
    toolResultBytes: [],
    compactions: [],
    duplicateCount: 0,
    malformedCount: 0,
  });
}

describe("GET /api/export — validation", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("rejects a missing format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("format") });
  });

  it("rejects an invalid format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=xml&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a missing from/to", async () => {
    const response = await app.inject({ method: "GET", url: "/api/export?format=csv" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("from") });
  });

  it("rejects from > to", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-19T00:00:00.000Z&to=2026-07-01T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("from must be <= to") });
  });

  it("rejects an unknown sort key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z&sort=garbage",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("sort") });
  });

  it("rejects minCostComputed > maxCostComputed", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z&minCostComputed=5&maxCostComputed=1",
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a bare-word date that Date.parse would otherwise accept", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=today&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("from") });
  });

  it("rejects a from..to span exceeding the 90-day cap", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=1970-01-01T00:00:00.000Z&to=2099-01-01T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("90 days") });
  });

  it("rejects more than 20 comma-separated values for a filter param", async () => {
    const project = Array.from({ length: 21 }, (_, i) => `p${i}`).join(",");
    const response = await app.inject({
      method: "GET",
      url: `/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z&project=${project}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("at most 20 values") });
  });
});

describe("GET /api/export — CSV", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("emits a header-only CSV for an empty matched population", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.headers["content-disposition"]).toContain(
      'attachment; filename="sessions-export-',
    );
    const lines = response.payload.trim().split("\r\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "sessionId,project,models,branch,host,entrypoint,version,startedAt,lastAt,durationMs,turnCount,totalTokens,cacheHitPct,costComputed,costObserved,linesAdded,linesRemoved,contextPctEstimated,gateScore,hasDrilldown,tierCostSamples,tierTurnBoundaries,tierCostLog",
    );
  });

  it("emits one row per matched session with the header first", async () => {
    addSession(store, {
      sessionId: "s1",
      timestamp: iso(2026, 6, 14, 10, 0),
      project: "/repo/alpha",
    });
    addSession(store, {
      sessionId: "s2",
      timestamp: iso(2026, 6, 15, 10, 0),
      project: "/repo/beta",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    const lines = response.payload.trim().split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]?.split(",")[0]).toBe("sessionId");
    const bodyIds = lines.slice(1).map((l) => l.split(",")[0]);
    expect(bodyIds.sort()).toEqual(["s1", "s2"]);
  });

  it("respects categorical filters", async () => {
    addSession(store, {
      sessionId: "s1",
      timestamp: iso(2026, 6, 14, 10, 0),
      project: "/repo/alpha",
    });
    addSession(store, {
      sessionId: "s2",
      timestamp: iso(2026, 6, 15, 10, 0),
      project: "/repo/beta",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z&project=/repo/alpha",
    });
    const lines = response.payload.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain("s1");
  });

  it("quotes fields containing commas or quotes (RFC4180)", async () => {
    addSession(store, {
      sessionId: "s1",
      timestamp: iso(2026, 6, 14, 10, 0),
      project: '/repo/al"pha,inc',
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    const lines = response.payload.trim().split("\r\n");
    // project column (2nd) must be quoted with doubled inner quote.
    expect(lines[1]).toContain('"/repo/al""pha,inc"');
  });

  it("joins multi-valued models with a semicolon", async () => {
    addSession(store, {
      sessionId: "s1",
      timestamp: iso(2026, 6, 14, 10, 0),
      model: "claude-sonnet-5",
    });
    addSession(store, {
      sessionId: "s1",
      timestamp: iso(2026, 6, 14, 10, 5),
      model: "claude-opus-5",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=csv&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    const lines = response.payload.trim().split("\r\n");
    expect(lines[1]).toContain("claude-sonnet-5;claude-opus-5");
  });
});

describe("GET /api/export — JSON", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("emits an empty array for an empty matched population", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=json&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain(
      'attachment; filename="sessions-export-',
    );
    expect(JSON.parse(response.payload)).toEqual([]);
  });

  it("round-trips a full-fidelity SessionPageItem array", async () => {
    addSession(store, {
      sessionId: "s1",
      timestamp: iso(2026, 6, 14, 10, 0),
      project: "/repo/alpha",
    });
    addSession(store, {
      sessionId: "s2",
      timestamp: iso(2026, 6, 15, 10, 0),
      project: "/repo/beta",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/export?format=json&from=2026-07-01T00:00:00.000Z&to=2026-07-19T00:00:00.000Z",
    });
    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.payload);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    const ids = parsed.map((item: { sessionId: string }) => item.sessionId).sort();
    expect(ids).toEqual(["s1", "s2"]);
    expect(parsed[0]).toHaveProperty("tier");
    expect(parsed[0]).toHaveProperty("models");
  });
});
