import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PromptTextRecord } from "../ingest/parse-transcript.js";
import { buildApp } from "../app.js";
import { buildRuntimeMetadata } from "../runtime.js";
import { Store } from "../store/store.js";
import type { ApiCall } from "../../shared/types.js";
import { parseSessionsQuery } from "./sessions.js";

// Same local-Date convention as routes/metrics.test.ts and metrics/engine.test.ts
// — `grain.ts` buckets by *local* calendar day, so hardcoded "...Z" timestamps
// would make bucket assignment depend on the machine running the test.
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
  // Prompt 1 minute before the call so derive-turns assigns the call to it
  // (a call with no preceding prompt never becomes a turn).
  const t = new Date(Date.parse(beforeTs) - 60_000).toISOString();
  return { sessionId, promptId, text, timestamp: t };
}

interface BuiltApp {
  app: FastifyInstance;
  store: Store;
}

function buildTestApp(): BuiltApp {
  // Default to runtime metadata so cost sort, trace cost projection, and
  // realistic cacheSavings all work end-to-end; validation 400s don't care.
  const metadata = buildRuntimeMetadata();
  const store = new Store({
    onInvalidate: () => {},
    pricer: metadata.pricer,
    pricing: metadata.pricing,
  });
  const app = buildApp({ store, logger: false, metadata });
  return { app, store };
}

/**
 * Applies one assistant call + one matching prompt to a session so
 * `deriveTurns` produces a single turn. Returns the session id.
 */
function addSession(
  store: Store,
  args: {
    sessionId: string;
    timestamp: string;
    model?: string;
    project?: string;
    branch?: string;
    inputTokens?: number;
    outputTokens?: number;
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
        usage: {
          inputTokens: args.inputTokens ?? 1000,
          outputTokens: args.outputTokens ?? 100,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        },
      }),
    ],
    prompts: [prompt(args.sessionId, promptId, "hi", ts)],
    toolResultBytes: [],
    duplicateCount: 0,
    malformedCount: 0,
  });
}

describe("GET /api/sessions — validation", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("rejects negative offset with a typed 400", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions?offset=-1" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("non-negative") });
  });

  it("silently caps limit at the documented maximum and surfaces it via a response header", async () => {
    // 99999 > MAX (100) — route silently caps to 100 and sets the header.
    const response = await app.inject({ method: "GET", url: "/api/sessions?limit=99999" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-sessions-limit-capped"]).toBe("100");
    // No sessions in the store — page is just empty.
    expect(response.json().items).toEqual([]);
  });

  it("rejects an unknown sort key with 400", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions?sort=garbage" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("sort must be") });
  });

  it("rejects from > to with 400 (cross-field date contradiction)", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions?from=${iso(2026, 6, 20)}&to=${iso(2026, 6, 10)}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("from must be <= to") });
  });
});

describe("GET /api/sessions — filtering and sorting", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
    // 6 sessions with varied firstAt/cost/project/model/branch. Two sessions
    // share firstAt so the deterministic tie-break on sessionId gets
    // exercised by every sort test below.
    addSession(store, {
      sessionId: "s-a",
      timestamp: iso(2026, 6, 10, 10, 0),
      project: "/repo/alpha",
      branch: "main",
      inputTokens: 100,
      outputTokens: 10,
    });
    addSession(store, {
      sessionId: "s-b",
      timestamp: iso(2026, 6, 12, 10, 0),
      project: "/repo/beta",
      branch: "feature",
      inputTokens: 5000,
      outputTokens: 500,
    });
    addSession(store, {
      sessionId: "s-c",
      timestamp: iso(2026, 6, 11, 10, 0),
      project: "/repo/alpha",
      branch: "main",
      inputTokens: 2000,
      outputTokens: 200,
    });
    addSession(store, {
      sessionId: "s-d",
      timestamp: iso(2026, 6, 14, 10, 0),
      project: "/repo/gamma",
      branch: "main",
      model: "claude-haiku-4-5",
      inputTokens: 100,
      outputTokens: 10,
    });
    addSession(store, {
      sessionId: "s-e",
      timestamp: iso(2026, 6, 13, 10, 0),
      project: "/repo/beta",
      branch: "main",
      inputTokens: 300,
      outputTokens: 30,
    });
    addSession(store, {
      sessionId: "s-f",
      timestamp: iso(2026, 6, 9, 10, 0),
      project: "/repo/alpha",
      branch: "feature",
      inputTokens: 100,
      outputTokens: 10,
    });
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("sort=lastAt is the default and returns recent-first", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(response.statusCode).toBe(200);
    const ids = response.json().items.map((item: { sessionId: string }) => item.sessionId);
    // s-d (Jul 14) -> s-e (Jul 13) -> s-b (Jul 12) -> s-c (Jul 11) -> s-a (Jul 10) -> s-f (Jul 9).
    expect(ids).toEqual(["s-d", "s-e", "s-b", "s-c", "s-a", "s-f"]);
  });

  it("each supported sort key works and order=asc reverses it", async () => {
    // buildTestApp injects the default pricer so cost values differ across
    // sessions — meaningful cost ordering below. Single-call sessions all
    // have durationMs = 0, so durationMs is a pure tie-break test.
    const cases: Array<{
      sort: string;
      desc: string[];
      asc: string[];
    }> = [
      // cost desc: s-b (largest input) > s-c > s-e; s-a/s-d/s-f tied and
      // tie-break-ordered asc on sessionId.
      {
        sort: "costComputed",
        desc: ["s-b", "s-c", "s-e", "s-a", "s-d", "s-f"],
        asc: ["s-a", "s-d", "s-f", "s-e", "s-c", "s-b"],
      },
      // All durations 0 → tie-break is asc on sessionId regardless of direction.
      {
        sort: "durationMs",
        desc: ["s-a", "s-b", "s-c", "s-d", "s-e", "s-f"],
        asc: ["s-a", "s-b", "s-c", "s-d", "s-e", "s-f"],
      },
      // maxTurnCost mirrors costComputed (one turn per session here).
      {
        sort: "maxTurnCostComputed",
        desc: ["s-b", "s-c", "s-e", "s-a", "s-d", "s-f"],
        asc: ["s-a", "s-d", "s-f", "s-e", "s-c", "s-b"],
      },
    ];
    for (const { sort, desc, asc } of cases) {
      const descResp = await app.inject({ method: "GET", url: `/api/sessions?sort=${sort}` });
      expect(descResp.statusCode).toBe(200);
      expect(descResp.json().items.map((i: { sessionId: string }) => i.sessionId)).toEqual(desc);

      const ascResp = await app.inject({
        method: "GET",
        url: `/api/sessions?sort=${sort}&order=asc`,
      });
      expect(ascResp.statusCode).toBe(200);
      expect(ascResp.json().items.map((i: { sessionId: string }) => i.sessionId)).toEqual(asc);
    }
  });

  it("sort=cacheSavingsComputed works (all values 0 today, so order is pure tie-break)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sessions?sort=cacheSavingsComputed",
    });
    expect(response.statusCode).toBe(200);
    // Pure deterministic tie-break on sessionId asc.
    expect(response.json().items.map((i: { sessionId: string }) => i.sessionId)).toEqual([
      "s-a",
      "s-b",
      "s-c",
      "s-d",
      "s-e",
      "s-f",
    ]);
  });

  it("CSV filters apply per dimension — project, model, branch", async () => {
    // project filter — alpha + beta (excludes gamma/s-d).
    const byProject = await app.inject({
      method: "GET",
      url: "/api/sessions?project=/repo/alpha,/repo/beta",
    });
    expect(byProject.statusCode).toBe(200);
    const projectIds = byProject
      .json()
      .items.map((i: { sessionId: string }) => i.sessionId)
      .sort();
    expect(projectIds).toEqual(["s-a", "s-b", "s-c", "s-e", "s-f"]);

    // model filter — only haiku sessions (s-d).
    const byModel = await app.inject({
      method: "GET",
      url: "/api/sessions?model=claude-haiku-4-5",
    });
    expect(byModel.statusCode).toBe(200);
    expect(byModel.json().items.map((i: { sessionId: string }) => i.sessionId)).toEqual(["s-d"]);

    // branch filter — only feature (s-b, s-f).
    const byBranch = await app.inject({
      method: "GET",
      url: "/api/sessions?branch=feature",
    });
    expect(byBranch.statusCode).toBe(200);
    const branchIds = byBranch
      .json()
      .items.map((i: { sessionId: string }) => i.sessionId)
      .sort();
    expect(branchIds).toEqual(["s-b", "s-f"]);
  });

  it("range filter respects the session-start convention ([from, to) on firstAt)", async () => {
    // Range covers s-a (Jul 10), s-b (Jul 12), s-c (Jul 11) but excludes
    // s-d (Jul 14), s-e (Jul 13), s-f (Jul 9). Half-open: from inclusive,
    // to exclusive — s-b at exactly `to` must be excluded.
    const response = await app.inject({
      method: "GET",
      url: `/api/sessions?from=${iso(2026, 6, 10)}&to=${iso(2026, 6, 12, 10, 0, 0)}`,
    });
    expect(response.statusCode).toBe(200);
    const ids = response
      .json()
      .items.map((i: { sessionId: string }) => i.sessionId)
      .sort();
    expect(ids).toEqual(["s-a", "s-c"]);
  });

  it("rejects an empty CSV filter as 400 (no silent 'no-filter' fallback)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions?project=" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("project") });
  });
});

describe("GET /api/sessions — pagination, trace, and meta", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
    // 20 sessions in insertion order s-00..s-19. lastAt increases with
    // sessionId so the default sort (lastAt desc) yields a deterministic
    // recent-first ordering that the pagination tests can rely on.
    for (let i = 0; i < 20; i++) {
      const id = `s-${String(i).padStart(2, "0")}`;
      addSession(store, {
        sessionId: id,
        timestamp: iso(2026, 6, 1 + i, 10, 0),
      });
    }
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("paginates deterministically — two consecutive pages have no overlap and total is 20", async () => {
    const page1 = await app.inject({ method: "GET", url: "/api/sessions?limit=10&offset=0" });
    const page2 = await app.inject({ method: "GET", url: "/api/sessions?limit=10&offset=10" });

    expect(page1.statusCode).toBe(200);
    expect(page2.statusCode).toBe(200);
    expect(page1.json().total).toBe(20);
    expect(page2.json().total).toBe(20);
    expect(page1.json().items).toHaveLength(10);
    expect(page2.json().items).toHaveLength(10);

    const ids1 = new Set(page1.json().items.map((i: { sessionId: string }) => i.sessionId));
    const ids2 = new Set(page2.json().items.map((i: { sessionId: string }) => i.sessionId));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
  });

  it("include=trace is accepted on small pages and produces cumulative priced turns", async () => {
    // Build a separate app with runtime metadata so trace has a real pricer.
    const meta = buildRuntimeMetadata();
    const traceStore = new Store({
      onInvalidate: () => {},
      pricer: meta.pricer,
      pricing: meta.pricing,
    });
    addSession(traceStore, {
      sessionId: "s-trace",
      timestamp: iso(2026, 6, 10, 10, 0),
      inputTokens: 1000,
      outputTokens: 100,
    });
    const traceApp = buildApp({ store: traceStore, logger: false, metadata: meta });

    try {
      const response = await traceApp.inject({
        method: "GET",
        url: "/api/sessions?include=trace&limit=5",
      });
      expect(response.statusCode).toBe(200);
      const items = response.json().items;
      expect(items).toHaveLength(1);
      expect(items[0].trace).toBeDefined();
      expect(items[0].trace).toHaveLength(1);
      // Cumulative cost for one turn with 1000 input + 100 output, default
      // sonnet rates (5/1M input, 25/1M output): 1000*5/1M + 100*25/1M =
      // 0.005 + 0.0025 = 0.0075.
      expect(items[0].trace[0].cost).toBeCloseTo(0.0075);
      expect(items[0].trace[0].turnIndex).toBe(0);
    } finally {
      traceStore.stop();
      await traceApp.close();
    }
  });

  it("include=trace rejects with 400 when limit exceeds the trace cap", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sessions?include=trace&limit=999",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: expect.stringContaining("include=trace") });
  });

  it("meta.matchedExtent spans the earliest/latest of the filtered set, or null when empty", async () => {
    const withMatches = await app.inject({
      method: "GET",
      url: `/api/sessions?from=${iso(2026, 6, 5)}&to=${iso(2026, 6, 25)}`,
    });
    expect(withMatches.statusCode).toBe(200);
    const extent = withMatches.json().meta.matchedExtent;
    expect(extent).not.toBeNull();
    expect(typeof extent.from).toBe("string");
    expect(typeof extent.to).toBe("string");
    expect(Date.parse(extent.from)).toBeLessThanOrEqual(Date.parse(extent.to));

    // Empty match set — no sessions in this window.
    const noMatches = await app.inject({
      method: "GET",
      url: `/api/sessions?from=${iso(2030, 0, 1)}&to=${iso(2030, 0, 2)}`,
    });
    expect(noMatches.statusCode).toBe(200);
    expect(noMatches.json().meta.matchedExtent).toBeNull();
    expect(noMatches.json().total).toBe(0);
    expect(noMatches.json().items).toEqual([]);
  });

  it('meta.matchedExtent ignores a session with no parsed calls yet (firstAt/lastAt still "")', async () => {
    // A session discovered but not yet tailed past its first line (or one
    // whose only lines so far don't produce an ApiCall) derives firstAt/
    // lastAt as "" (derive-session.ts's unset sentinel). "" sorts before
    // every real timestamp, so without a guard it would corrupt the extent
    // to an empty string — which then fails /api/metrics's date validation
    // when a caller (e.g. the dashboard's RecordsStrip) forwards it as
    // range.from. No from/to here (RecordsStrip's real query has none,
    // decision A7) — a date filter would exclude "" via
    // `session.firstAt < params.from` before the extent is even computed,
    // masking the bug this test guards against.
    store.applyRecords("s-empty", {
      calls: [],
      prompts: [],
      toolResultBytes: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    const response = await app.inject({ method: "GET", url: "/api/sessions?limit=1" });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(21);
    const extent = response.json().meta.matchedExtent;
    expect(extent).not.toBeNull();
    expect(extent.from).not.toBe("");
    expect(extent.to).not.toBe("");
    expect(Date.parse(extent.from)).toBeLessThanOrEqual(Date.parse(extent.to));
  });

  it("meta.globalCapture reflects the unfiltered file set — filter-independent", async () => {
    // Mark one session's sidecar so the OR-aggregate flips a flag.
    store.markSidecarPresent("s-05", "cost");

    // Unfiltered view — hasCostSamples must be true.
    const unfiltered = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(unfiltered.statusCode).toBe(200);
    expect(unfiltered.json().meta.globalCapture.hasCostSamples).toBe(true);

    // Filtered to a window that EXCLUDES s-05 — globalCapture must STILL
    // reflect the unfiltered file set (this is the section-level lock).
    const filtered = await app.inject({
      method: "GET",
      url: `/api/sessions?from=${iso(2026, 6, 1)}&to=${iso(2026, 6, 5)}`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().meta.globalCapture.hasCostSamples).toBe(true);
    expect(filtered.json().total).toBeLessThan(20);
  });
});

describe("GET /api/sessions — app registration regression guard", () => {
  let app: FastifyInstance;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = buildTestApp());
    addSession(store, {
      sessionId: "s-reg",
      timestamp: iso(2026, 6, 10, 10, 0),
    });
  });

  afterEach(async () => {
    store.stop();
    await app.close();
  });

  it("GET /api/sessions resolves to 200 (route is registered exactly once)", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("items");
    expect(response.json()).toHaveProperty("total");
    expect(response.json()).toHaveProperty("meta");
  });

  it("POST /api/metrics still resolves (existing routes are unchanged)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/metrics",
      payload: {
        measures: ["apiCalls"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 9), to: iso(2026, 6, 11) },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  it("parseSessionsQuery unit — covers CSV/empty/range/sort/integer validation in isolation", () => {
    // Lightweight unit checks so a future parser refactor stays honest with
    // the route-level integration tests above.
    expect(parseSessionsQuery({ sort: "lastAt", order: "desc", limit: "5", offset: "0" })).toEqual({
      sort: "lastAt",
      order: "desc",
      limit: 5,
      offset: 0,
    });
    expect(typeof parseSessionsQuery({ sort: "nope" })).toBe("string");
    expect(typeof parseSessionsQuery({ limit: "abc" })).toBe("string");
    expect(typeof parseSessionsQuery({ offset: -1 })).toBe("string");
    expect(typeof parseSessionsQuery({ project: "" })).toBe("string");
    expect(typeof parseSessionsQuery({ from: "nope", to: iso(2026, 6, 1) })).toBe("string");
    expect(typeof parseSessionsQuery({ from: iso(2026, 6, 2), to: iso(2026, 6, 1) })).toBe(
      "string",
    );
    expect(parseSessionsQuery({ project: "a,b" })).toMatchObject({ project: ["a", "b"] });
  });
});
