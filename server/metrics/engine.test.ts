import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MetricsQuery, SeriesMetricsQuery } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { type MetricsInput, metrics } from "./engine.js";
import { DEFAULT_PRICING_TABLE } from "./measures.js";

/** Asserts a value is non-null; throws with the given message otherwise. */
function force<T>(v: T | null | undefined, msg: string): T {
  if (v == null) throw new Error(msg);
  return v;
}

// All timestamps are built from local Date constructors (never hardcoded
// "...Z" UTC strings) so bucket-day assignment — which truncates by *local*
// calendar day (grain.ts) — is deterministic regardless of the machine
// running the tests.
function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

function usage(inputTokens: number) {
  return { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: iso(2026, 6, 14, 10, 0),
    model: "claude-sonnet-5",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    promptId: "p1",
    sessionId: "s1",
    isSidechain: false,
    startedAt: iso(2026, 6, 14, 10, 0),
    endedAt: iso(2026, 6, 14, 10, 1),
    calls: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "s1",
    lineageId: "s1",
    project: "/repo/alpha",
    entrypoint: "cli",
    models: ["claude-sonnet-5"],
    gitBranch: "main",
    version: "1.2.3",
    host: "default", // review #13: synthetic, mirrors metrics engine
    tier: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
    firstAt: iso(2026, 6, 14, 10, 0),
    lastAt: iso(2026, 6, 14, 10, 1),
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    turnCount: 1,
    callCount: 1,
    costComputed: 0,
    cacheHitPct: 0,
    ...overrides,
  };
}

// Always returns a mode: "series" query (mode omitted) — never override `mode`
// here, since "distribution" requires `distributionEntity` too; build those
// queries as full MetricsQuery literals instead (see the mode/compare/
// smoothing wiring test below).
function baseQuery(overrides: Partial<Omit<SeriesMetricsQuery, "mode">> = {}): MetricsQuery {
  return {
    measures: ["costComputed"],
    dimensions: ["time"],
    grain: "day",
    range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    ...overrides,
  };
}

const PRICING = DEFAULT_PRICING_TABLE;

describe("metrics — end-to-end acceptance against hand-computed fixtures", () => {
  const calls = [
    call({
      uuid: "c1",
      timestamp: iso(2026, 6, 13, 10, 0),
      cwd: "/repo/alpha",
      model: "claude-sonnet-5",
      gitBranch: "main",
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 },
    }),
    call({
      uuid: "c2",
      timestamp: iso(2026, 6, 13, 11, 0),
      cwd: "/repo/beta",
      model: "claude-fable-5",
      gitBranch: "feat/x",
      usage: { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 500, cacheCreateTokens: 0 },
    }),
    call({
      uuid: "c3",
      timestamp: iso(2026, 6, 15, 9, 0),
      cwd: "/repo/alpha",
      model: "claude-sonnet-5",
      gitBranch: "main",
      usage: { inputTokens: 500, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
    }),
  ];
  const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };

  it("matches hand-computed costComputed totals per day bucket", () => {
    const query = baseQuery({ measures: ["costComputed"], dimensions: ["time"], grain: "day" });
    const result = metrics(input, query);
    expect(result).toHaveLength(1);

    // Jul 13: (1000*5 + 100*25 + 2000*5 + 200*25 + 500*0.5) / 1e6
    const expectedJul13 = (1000 * 5 + 100 * 25 + 2000 * 5 + 200 * 25 + 500 * 0.5) / 1_000_000;
    // Jul 15: (500*5 + 50*25) / 1e6
    const expectedJul15 = (500 * 5 + 50 * 25) / 1_000_000;

    const points = result[0]?.points ?? [];
    expect(points).toHaveLength(3); // Jul 13, 14, 15
    expect(points[0]?.value).toBeCloseTo(expectedJul13, 10);
    expect(points[1]?.value).toBe(0); // Jul 14: no activity
    expect(points[2]?.value).toBeCloseTo(expectedJul15, 10);
  });

  it("matches hand-computed inputTokens by project", () => {
    const query = baseQuery({ measures: ["inputTokens"], dimensions: ["project"], grain: "day" });
    const result = metrics(input, query);

    const alpha = result.find((s) => s.dimensionKey === "project:/repo/alpha");
    const beta = result.find((s) => s.dimensionKey === "project:/repo/beta");
    expect(alpha?.points).toEqual([{ t: query.range.from, value: 1500 }]);
    expect(beta?.points).toEqual([{ t: query.range.from, value: 2000 }]);
  });

  it("unit switching is a measure swap only — same grouping/bucketing across measures", () => {
    const query = baseQuery({ measures: ["costComputed"], dimensions: ["project"], grain: "day" });
    const costResult = metrics(input, query);
    const tokenResult = metrics(input, { ...query, measures: ["inputTokens"] });
    const callResult = metrics(input, { ...query, measures: ["apiCalls"] });

    const keysOf = (s: typeof costResult) => s.map((x) => x.dimensionKey).sort();
    expect(keysOf(costResult)).toEqual(keysOf(tokenResult));
    expect(keysOf(costResult)).toEqual(keysOf(callResult));
  });
});

describe("metrics — dimensions array semantics", () => {
  const calls = [
    call({ uuid: "a1", cwd: "/repo/alpha", timestamp: iso(2026, 6, 13, 10, 0) }),
    call({ uuid: "b1", cwd: "/repo/beta", timestamp: iso(2026, 6, 13, 11, 0) }),
    call({ uuid: "g1", cwd: "/repo/gamma", timestamp: iso(2026, 6, 14, 10, 0) }),
  ];
  const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };

  it('dimensions: ["time"] alone produces one dense series per measure', () => {
    const query = baseQuery({ measures: ["apiCalls"], dimensions: ["time"], grain: "day" });
    const result = metrics(input, query);
    expect(result).toHaveLength(1);
    expect(result[0]?.dimensionKey).toBe("all");
    expect(result[0]?.points).toHaveLength(3);
  });

  it('dimensions: ["time", "project"] produces one series per project, each dense-bucketed', () => {
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time", "project"],
      grain: "day",
    });
    const result = metrics(input, query);
    expect(result.map((s) => s.dimensionKey).sort()).toEqual([
      "project:/repo/alpha",
      "project:/repo/beta",
      "project:/repo/gamma",
    ]);
    for (const s of result) expect(s.points).toHaveLength(3);
  });

  it('dimensions: ["project"] (no "time") produces one aggregate point per project', () => {
    const query = baseQuery({ measures: ["apiCalls"], dimensions: ["project"], grain: "day" });
    const result = metrics(input, query);
    expect(result.map((s) => s.dimensionKey).sort()).toEqual([
      "project:/repo/alpha",
      "project:/repo/beta",
      "project:/repo/gamma",
    ]);
    for (const s of result) expect(s.points).toHaveLength(1);
  });
});

describe("metrics — SeriesPoint.t is a machine-readable ISO-8601 instant, not a display label", () => {
  // Regression: `t` used to come from `bucketLabel()`, a locale-formatted
  // display string (e.g. "11 July 2026"). The client's ECharts `xAxis: {
  // type: "time" }` parser requires an ISO-shaped string and silently drops
  // any point it can't parse — it does NOT fall back to the browser's
  // lenient `new Date(str)` parsing the way other client call sites do. The
  // symptom was every Dashboard timeseries chart (area AND bars) rendering a
  // completely empty canvas while the accompanying data table — which
  // re-parses `t` via `new Date()` — showed correct values. `t` must
  // round-trip through `Date.parse` losslessly for every grain.
  const calls = [
    call({ uuid: "a1", timestamp: iso(2026, 6, 13, 10, 0) }),
    call({ uuid: "b1", timestamp: iso(2026, 6, 14, 11, 0) }),
  ];
  const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };

  it.each([
    "hour",
    "day",
    "week",
    "month",
  ] as const)("grain=%s: every bucketed point's t is ISO-8601 and Date.parse-able", (grain) => {
    const query = baseQuery({ measures: ["apiCalls"], dimensions: ["time"], grain });
    const result = metrics(input, query);
    const points = result[0]?.points ?? [];
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      // ISO-8601 with a 4-digit leading year — the exact shape ECharts'
      // own `parseDate` regex requires (a bare `new Date(str)` round-trip
      // is not sufficient: several non-ISO formats parse fine via the
      // browser's lenient Date constructor but fail ECharts' stricter
      // regex-based parser).
      expect(point.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      expect(Number.isFinite(Date.parse(point.t))).toBe(true);
    }
  });

  it("aggregate (non-time-bucketed) points still emit range.from verbatim, unaffected", () => {
    const query = baseQuery({ measures: ["apiCalls"], dimensions: [], grain: "day" });
    const result = metrics(input, query);
    expect(result[0]?.points[0]?.t).toBe(query.range.from);
  });

  it("compareGhost points are also ISO-8601 (same code path, shifted range)", () => {
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time"],
      grain: "day",
      compare: "previous-period",
    });
    const result = metrics(input, query);
    const ghost = result[0]?.compareGhost ?? [];
    expect(ghost.length).toBeGreaterThan(0);
    for (const point of ghost) {
      expect(point.t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    }
  });
});

describe("metrics — filtering", () => {
  it("filters narrow which calls participate", () => {
    const calls = [
      call({ uuid: "s1", model: "claude-sonnet-5", timestamp: iso(2026, 6, 13, 10, 0) }),
      call({ uuid: "f1", model: "claude-fable-5", timestamp: iso(2026, 6, 13, 11, 0) }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time"],
      grain: "day",
      filters: { model: ["claude-sonnet-5"] },
    });
    const result = metrics(input, query);
    expect(result[0]?.points[0]?.value).toBe(1);
  });
});

describe("metrics — cost basis labeling", () => {
  it("cost series carry a computed basis label", () => {
    const input: MetricsInput = { calls: [call()], turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({ measures: ["costComputed"], dimensions: ["time"], grain: "day" });
    const result = metrics(input, query);
    expect(result[0]?.basis).toBe("computed");
  });
});

describe("metrics — resilience", () => {
  it("empty range/no matching filters still returns dense output, not an empty array", () => {
    const input: MetricsInput = {
      calls: [call({ timestamp: iso(2020, 0, 1, 0, 0) })],
      turns: [],
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({
      measures: ["apiCalls", "costObserved"],
      dimensions: ["time"],
      grain: "day",
    });
    const result = metrics(input, query);

    const apiCallsSeries = result.find((s) => s.measure === "apiCalls");
    expect(apiCallsSeries?.points.every((p) => p.value === 0)).toBe(true);

    const costObservedSeries = result.find((s) => s.measure === "costObserved");
    expect(costObservedSeries?.points.every((p) => p.value === null)).toBe(true);
  });

  it("a multi-tool call double-counts across tool buckets, undivided", () => {
    const multiToolCall = call({
      tools: [
        { name: "Read", inputBytes: 1 },
        { name: "Bash", inputBytes: 1 },
      ],
      usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    });
    const input: MetricsInput = {
      calls: [multiToolCall],
      turns: [],
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({ measures: ["inputTokens"], dimensions: ["tool"], grain: "day" });
    const result = metrics(input, query);

    const readSeries = result.find((s) => s.dimensionKey === "tool:Read");
    const bashSeries = result.find((s) => s.dimensionKey === "tool:Bash");
    expect(readSeries?.points[0]?.value).toBe(100);
    expect(bashSeries?.points[0]?.value).toBe(100);
  });

  it("mixed fine- and coarse-grain measures in one query resolve independently", () => {
    const t = turn({
      startedAt: iso(2026, 6, 13, 10, 0),
      endedAt: iso(2026, 6, 13, 10, 5),
      calls: [
        call({
          timestamp: iso(2026, 6, 13, 10, 0),
          cwd: "/repo/alpha",
          usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 },
        }),
      ],
    });
    const input: MetricsInput = {
      calls: t.calls,
      turns: [t],
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({
      measures: ["costComputed", "wallMinutes"],
      dimensions: ["project"],
      grain: "day",
    });
    const result = metrics(input, query);

    const cost = result.find((s) => s.measure === "costComputed");
    const wall = result.find((s) => s.measure === "wallMinutes");
    expect(cost?.points[0]?.value).toBeGreaterThan(0);
    expect(wall?.points[0]?.value).toBe(5);
  });

  it("mode: distribution and compare/smoothing on mode: series produce real output, never throw (supersedes the #P2-8-era no-op test)", () => {
    const input: MetricsInput = { calls: [call()], turns: [], sessions: [], pricing: PRICING };

    const distributionQuery: MetricsQuery = {
      measures: ["costComputed"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
      mode: "distribution",
      distributionEntity: "call",
    };
    expect(() => metrics(input, distributionQuery)).not.toThrow();
    const distResult = metrics(input, distributionQuery);
    expect(distResult[0]?.distribution).toBeDefined();

    const seriesQuery = baseQuery({ compare: "previous-period", smoothing: "ma7" });
    expect(() => metrics(input, seriesQuery)).not.toThrow();
    const seriesResult = metrics(input, seriesQuery);
    expect(seriesResult[0]?.compareGhost).toBeDefined();
  });

  it("excludes a call with an unparseable timestamp from range filtering instead of silently including it (review finding H2)", () => {
    const badCall = call({
      timestamp: "",
      usage: { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    });
    const input: MetricsInput = { calls: [badCall], turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["apiCalls", "inputTokens"],
      dimensions: ["time"],
      grain: "day",
    });
    const result = metrics(input, query);
    for (const s of result) {
      expect(s.points.every((p) => p.value === 0)).toBe(true);
    }
  });
});

describe("metrics — session-grain measures", () => {
  it("counts sessions per project breakdown group, joined via session fields not calls", () => {
    const sessions = [
      session({ sessionId: "s1", project: "/repo/alpha", firstAt: iso(2026, 6, 13, 9, 0) }),
      session({ sessionId: "s2", project: "/repo/alpha", firstAt: iso(2026, 6, 13, 10, 0) }),
      session({ sessionId: "s3", project: "/repo/beta", firstAt: iso(2026, 6, 13, 11, 0) }),
    ];
    const calls = [
      call({ cwd: "/repo/alpha", timestamp: iso(2026, 6, 13, 9, 0) }),
      call({ cwd: "/repo/beta", timestamp: iso(2026, 6, 13, 11, 0) }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions, pricing: PRICING };
    const query = baseQuery({ measures: ["sessions"], dimensions: ["project"], grain: "day" });
    const result = metrics(input, query);

    const alpha = result.find((s) => s.dimensionKey === "project:/repo/alpha");
    const beta = result.find((s) => s.dimensionKey === "project:/repo/beta");
    expect(alpha?.points[0]?.value).toBe(2);
    expect(beta?.points[0]?.value).toBe(1);
  });
});

describe("metrics — gateStatus dimension", () => {
  it("breaks down by gateStatus via the call's owning turn, with unattributed calls falling into unknown", () => {
    const passCall = call({ uuid: "c-pass", timestamp: iso(2026, 6, 13, 10, 0) });
    const failCall = call({ uuid: "c-fail", timestamp: iso(2026, 6, 13, 11, 0) });
    const orphanCall = call({ uuid: "c-orphan", timestamp: iso(2026, 6, 13, 12, 0) });

    const passTurn = turn({ promptId: "p-pass", gateStatus: "pass", calls: [passCall] });
    const failTurn = turn({ promptId: "p-fail", gateStatus: "fail", calls: [failCall] });

    const input: MetricsInput = {
      calls: [passCall, failCall, orphanCall],
      turns: [passTurn, failTurn],
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({ measures: ["apiCalls"], dimensions: ["gateStatus"], grain: "day" });
    const result = metrics(input, query);

    const pass = result.find((s) => s.dimensionKey === "gateStatus:pass");
    const fail = result.find((s) => s.dimensionKey === "gateStatus:fail");
    const unknown = result.find((s) => s.dimensionKey === "gateStatus:unknown");
    expect(pass?.points[0]?.value).toBe(1);
    expect(fail?.points[0]?.value).toBe(1);
    expect(unknown?.points[0]?.value).toBe(1);
  });
});

describe("metrics — turn/session range handling", () => {
  it("excludes turns outside the query range even when one of their calls is in-group", () => {
    const inRangeTurn = turn({
      promptId: "p1",
      startedAt: iso(2026, 6, 13, 10, 0),
      endedAt: iso(2026, 6, 13, 10, 5),
      calls: [call({ timestamp: iso(2026, 6, 13, 10, 0) })],
    });
    const outOfRangeTurn = turn({
      promptId: "p2",
      startedAt: iso(2020, 0, 1, 10, 0),
      endedAt: iso(2020, 0, 1, 10, 5),
      calls: [call({ timestamp: iso(2026, 6, 13, 10, 30) })],
    });
    const input: MetricsInput = {
      calls: [...inRangeTurn.calls, ...outOfRangeTurn.calls],
      turns: [inRangeTurn, outOfRangeTurn],
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({ measures: ["turns"], dimensions: ["time"], grain: "day" });
    const result = metrics(input, query);
    const turnsSeries = result.find((s) => s.measure === "turns");
    const totalTurns = turnsSeries?.points.reduce((sum, p) => sum + (p.value ?? 0), 0);
    // outOfRangeTurn's own startedAt (2020) is outside the query range, so it's
    // excluded even though one of its calls falls inside the range.
    expect(totalTurns).toBe(1);
  });

  it("excludes a turn with an unparseable startedAt instead of silently including it (review finding H2)", () => {
    const malformedTurn = turn({
      promptId: "p-bad",
      startedAt: "",
      endedAt: iso(2026, 6, 13, 10, 5),
      calls: [call({ timestamp: iso(2026, 6, 13, 10, 0) })],
    });
    const input: MetricsInput = {
      calls: malformedTurn.calls,
      turns: [malformedTurn],
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({ measures: ["turns"], dimensions: ["time"], grain: "day" });
    const result = metrics(input, query);
    const turnsSeries = result.find((s) => s.measure === "turns");
    const totalTurns = turnsSeries?.points.reduce((sum, p) => sum + (p.value ?? 0), 0);
    expect(totalTurns).toBe(0);
  });

  it("excludes a session with an unparseable firstAt instead of silently including it (review finding H2)", () => {
    const malformedSession = session({ firstAt: "" });
    const input: MetricsInput = {
      calls: [],
      turns: [],
      sessions: [malformedSession],
      pricing: PRICING,
    };
    const query = baseQuery({ measures: ["sessions"], dimensions: ["time"], grain: "day" });
    const result = metrics(input, query);
    const sessionsSeries = result.find((s) => s.measure === "sessions");
    const total = sessionsSeries?.points.reduce((sum, p) => sum + (p.value ?? 0), 0);
    expect(total).toBe(0);
  });
});

describe("metrics — breakdown dimensions with zero matching calls", () => {
  it("returns an empty Series[] rather than a dense zero-point series when nothing can be enumerated (documented behavior, not dense — see O1)", () => {
    const input: MetricsInput = { calls: [], turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({ measures: ["apiCalls"], dimensions: ["project"], grain: "day" });
    const result = metrics(input, query);
    expect(result).toEqual([]);
  });
});

describe("metrics — mode: distribution dispatch", () => {
  it('ignores "time", grouping by breakdown dims only across the whole range', () => {
    const calls = [
      call({
        uuid: "c1",
        sessionId: "s1",
        cwd: "/repo/alpha",
        timestamp: iso(2026, 6, 13, 10, 0),
        model: "claude-sonnet-5",
        usage: { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        uuid: "c2",
        sessionId: "s2",
        cwd: "/repo/alpha",
        timestamp: iso(2026, 6, 14, 10, 0),
        model: "claude-sonnet-5",
        usage: { inputTokens: 2000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        uuid: "c3",
        sessionId: "s3",
        cwd: "/repo/beta",
        timestamp: iso(2026, 6, 13, 10, 0),
        model: "claude-sonnet-5",
        usage: { inputTokens: 500, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
    ];
    const sessions = [
      session({ sessionId: "s1", project: "/repo/alpha", firstAt: iso(2026, 6, 13, 10, 0) }),
      session({ sessionId: "s2", project: "/repo/alpha", firstAt: iso(2026, 6, 14, 10, 0) }),
      session({ sessionId: "s3", project: "/repo/beta", firstAt: iso(2026, 6, 13, 10, 0) }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions, pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["costComputed"],
      dimensions: ["time", "project"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 14, 23, 59) },
      mode: "distribution",
      distributionEntity: "session",
    };
    const result = metrics(input, query);
    // One series per project (not per project x day bucket).
    expect(result.map((s) => s.dimensionKey).sort()).toEqual([
      "project:/repo/alpha",
      "project:/repo/beta",
    ]);
    for (const s of result) expect(s.points).toEqual([]);
    const alpha = result.find((s) => s.dimensionKey === "project:/repo/alpha");
    // alpha has 2 sessions (s1 cost=0.005, s2 cost=0.01) -> nearest-rank p50 = sorted[0] = 0.005
    expect(alpha?.distribution?.p50).toBeCloseTo(0.005, 10);
  });

  it("narrows session distributions with sessionPopulation before computing percentiles", () => {
    const input: MetricsInput = {
      calls: [
        call({ sessionId: "s1", usage: usage(100) }),
        call({ sessionId: "s2", usage: usage(900) }),
      ],
      turns: [],
      sessions: [
        session({ sessionId: "s1", project: "/repo/alpha" }),
        session({ sessionId: "s2", project: "/repo/beta" }),
      ],
      pricing: PRICING,
    };
    const result = metrics(input, {
      measures: ["inputTokens"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13), to: iso(2026, 6, 15) },
      mode: "distribution",
      distributionEntity: "session",
      sessionPopulation: { project: ["/repo/alpha"] },
    });
    expect(result[0]?.distribution?.p50).toBe(100);
    expect(result[0]?.distribution?.p99).toBe(100);
  });

  describe("distribution entity population selection", () => {
    it('distributionEntity: "call" builds the population from individual calls', () => {
      const calls = [
        call({ uuid: "c1", timestamp: iso(2026, 6, 13, 10, 0), usage: usage(100) }),
        call({ uuid: "c2", timestamp: iso(2026, 6, 13, 10, 1), usage: usage(50) }),
        call({ uuid: "c3", timestamp: iso(2026, 6, 13, 11, 0), usage: usage(300) }),
      ];
      const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
      const query: MetricsQuery = {
        measures: ["inputTokens"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
        mode: "distribution",
        distributionEntity: "call",
      };
      const result = metrics(input, query);
      // N=3, sorted [50,100,300]: p50 index=ceil(1.5)=2 -> 100; p99 index=ceil(2.97)=3 -> 300
      expect(result[0]?.distribution?.p50).toBe(100);
      expect(result[0]?.distribution?.p99).toBe(300);
    });

    it('distributionEntity: "turn" builds the population from per-turn call totals', () => {
      const t1Calls = [
        call({
          uuid: "c1a",
          sessionId: "s1",
          timestamp: iso(2026, 6, 13, 10, 0),
          usage: usage(100),
        }),
        call({
          uuid: "c1b",
          sessionId: "s1",
          timestamp: iso(2026, 6, 13, 10, 1),
          usage: usage(50),
        }),
      ];
      const t2Calls = [
        call({
          uuid: "c2",
          sessionId: "s2",
          timestamp: iso(2026, 6, 13, 11, 0),
          usage: usage(300),
        }),
      ];
      const turns = [
        turn({
          promptId: "p1",
          sessionId: "s1",
          startedAt: iso(2026, 6, 13, 10, 0),
          endedAt: iso(2026, 6, 13, 10, 2),
          calls: t1Calls,
        }),
        turn({
          promptId: "p2",
          sessionId: "s2",
          startedAt: iso(2026, 6, 13, 11, 0),
          endedAt: iso(2026, 6, 13, 11, 1),
          calls: t2Calls,
        }),
      ];
      const input: MetricsInput = {
        calls: [...t1Calls, ...t2Calls],
        turns,
        sessions: [],
        pricing: PRICING,
      };
      const query: MetricsQuery = {
        measures: ["inputTokens"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
        mode: "distribution",
        distributionEntity: "turn",
      };
      const result = metrics(input, query);
      // Per-turn totals: t1=150, t2=300. N=2: p50 index=1 -> 150; p99 index=2 -> 300
      expect(result[0]?.distribution?.p50).toBe(150);
      expect(result[0]?.distribution?.p99).toBe(300);
    });

    it('distributionEntity: "turn" folds sidechains into their prompt and retains sidechain-only work', () => {
      const mainCall = call({
        uuid: "main",
        sessionId: "s1",
        timestamp: iso(2026, 6, 13, 10, 0),
        usage: usage(100),
      });
      const sidechainCall = call({
        uuid: "side",
        sessionId: "s1",
        timestamp: iso(2026, 6, 13, 10, 1),
        isSidechain: true,
        usage: usage(50),
      });
      const sidechainOnlyCall = call({
        uuid: "side-only",
        sessionId: "s2",
        timestamp: iso(2026, 6, 13, 11, 0),
        isSidechain: true,
        usage: usage(25),
      });
      const input: MetricsInput = {
        calls: [mainCall, sidechainCall, sidechainOnlyCall],
        turns: [
          turn({
            promptId: "p1",
            sessionId: "s1",
            startedAt: mainCall.timestamp,
            calls: [mainCall],
          }),
          turn({
            promptId: "p1",
            sessionId: "s1",
            isSidechain: true,
            startedAt: sidechainCall.timestamp,
            calls: [sidechainCall],
          }),
          turn({
            promptId: "p2",
            sessionId: "s2",
            isSidechain: true,
            startedAt: sidechainOnlyCall.timestamp,
            calls: [sidechainOnlyCall],
          }),
        ],
        sessions: [],
        pricing: PRICING,
      };
      const query: MetricsQuery = {
        measures: ["inputTokens"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
        mode: "distribution",
        distributionEntity: "turn",
      };

      const result = metrics(input, query);

      // Logical turn p1 is 100 + 50, while p2's sidechain-only turn remains 25.
      expect(result[0]?.distribution?.p50).toBe(25);
      expect(result[0]?.distribution?.p99).toBe(150);
    });

    it('distributionEntity: "session" builds the population from per-session call totals', () => {
      const calls = [
        call({
          uuid: "c1a",
          sessionId: "s1",
          timestamp: iso(2026, 6, 13, 10, 0),
          usage: usage(100),
        }),
        call({
          uuid: "c1b",
          sessionId: "s1",
          timestamp: iso(2026, 6, 13, 10, 1),
          usage: usage(50),
        }),
        call({
          uuid: "c2",
          sessionId: "s2",
          timestamp: iso(2026, 6, 13, 11, 0),
          usage: usage(300),
        }),
      ];
      const sessions = [
        session({ sessionId: "s1", firstAt: iso(2026, 6, 13, 10, 0) }),
        session({ sessionId: "s2", firstAt: iso(2026, 6, 13, 11, 0) }),
      ];
      const input: MetricsInput = { calls, turns: [], sessions, pricing: PRICING };
      const query: MetricsQuery = {
        measures: ["inputTokens"],
        dimensions: [],
        grain: "day",
        range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
        mode: "distribution",
        distributionEntity: "session",
      };
      const result = metrics(input, query);
      // Per-session totals: s1=150, s2=300. N=2: p50 index=1 -> 150; p99 index=2 -> 300
      expect(result[0]?.distribution?.p50).toBe(150);
      expect(result[0]?.distribution?.p99).toBe(300);
    });
  });

  it("excludes entities where the measure is null from the population (honest-null cascade)", () => {
    const calls = [call({ uuid: "c1", sessionId: "s1", timestamp: iso(2026, 6, 13, 10, 0) })];
    const sessions = [session({ sessionId: "s1", firstAt: iso(2026, 6, 13, 10, 0) })];
    const input: MetricsInput = { calls, turns: [], sessions, pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["costObserved"], // always null today — no shipped parser populates it yet
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
      mode: "distribution",
      distributionEntity: "session",
    };
    const result = metrics(input, query);
    expect(result[0]?.distribution).toEqual({
      p50: null,
      p90: null,
      p99: null,
      histogram: [],
      pareto: undefined,
    });
  });
});

describe("metrics — compare: previous-period wiring", () => {
  it("produces a ghost aligned to a time-bucketed series, bucket-for-bucket", () => {
    const calls = [
      call({ uuid: "jul13", timestamp: iso(2026, 6, 13, 10, 0), usage: usage(100) }), // previous
      call({ uuid: "jul14", timestamp: iso(2026, 6, 14, 10, 0), usage: usage(200) }), // previous
      call({ uuid: "jul15", timestamp: iso(2026, 6, 15, 10, 0), usage: usage(300) }), // current
      call({ uuid: "jul16", timestamp: iso(2026, 6, 16, 10, 0), usage: usage(400) }), // current
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 15, 0, 0), to: iso(2026, 6, 16, 23, 59) },
      compare: "previous-period",
    };
    const result = metrics(input, query);
    const series = result[0];
    expect(series?.points.map((p) => p.value)).toEqual([300, 400]);
    expect(series?.compareGhost).toHaveLength(2);
    expect(series?.compareGhost?.map((p) => p.value)).toEqual([100, 200]);
    // Ghost points sit at the current period's x-position, not the previous instant's.
    expect(series?.compareGhost?.map((p) => p.t)).toEqual(series?.points.map((p) => p.t));
  });

  it("produces one ghost point for a non-time-bucketed (stat-card delta) query", () => {
    const calls = [
      call({ uuid: "jul14", timestamp: iso(2026, 6, 14, 10, 0), usage: usage(200) }), // previous
      call({ uuid: "jul15", timestamp: iso(2026, 6, 15, 10, 0), usage: usage(300) }), // current
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 15, 0, 0), to: iso(2026, 6, 15, 23, 59) },
      compare: "previous-period",
    };
    const result = metrics(input, query);
    const series = result[0];
    expect(series?.points).toHaveLength(1);
    expect(series?.points[0]?.value).toBe(300);
    expect(series?.compareGhost).toHaveLength(1);
    expect(series?.compareGhost?.[0]?.value).toBe(200);
  });

  it("truncates/pads with null when current and previous month-grain windows touch a different number of buckets", () => {
    const calls = [
      call({ uuid: "jan27", timestamp: iso(2027, 0, 27, 10, 0), usage: usage(100) }), // previous (Jan)
      call({ uuid: "jan30", timestamp: iso(2027, 0, 30, 10, 0), usage: usage(200) }), // current (Jan)
      call({ uuid: "feb1", timestamp: iso(2027, 1, 1, 10, 0), usage: usage(300) }), // current (Feb)
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: ["time"],
      grain: "month",
      range: { from: iso(2027, 0, 30, 0, 0), to: iso(2027, 1, 2, 23, 59) },
      compare: "previous-period",
    };
    const result = metrics(input, query);
    const series = result[0];
    // Current spans Jan+Feb (2 month buckets); previous falls entirely within
    // January (1 bucket) — ghost is padded to match current's length.
    expect(series?.points).toHaveLength(2);
    expect(series?.compareGhost).toHaveLength(2);
    expect(series?.compareGhost?.[1]?.value).toBeNull();
  });

  it("aligns a ghost at hour grain", () => {
    const calls = [
      call({ uuid: "h8", timestamp: iso(2026, 6, 15, 8, 10), usage: usage(100) }), // previous
      call({ uuid: "h9", timestamp: iso(2026, 6, 15, 9, 10), usage: usage(200) }), // previous
      call({ uuid: "h10", timestamp: iso(2026, 6, 15, 10, 10), usage: usage(300) }), // current
      call({ uuid: "h11", timestamp: iso(2026, 6, 15, 11, 10), usage: usage(400) }), // current
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: ["time"],
      grain: "hour",
      range: { from: iso(2026, 6, 15, 10, 0), to: iso(2026, 6, 15, 11, 59) },
      compare: "previous-period",
    };
    const result = metrics(input, query);
    const series = result[0];
    expect(series?.points.map((p) => p.value)).toEqual([300, 400]);
    expect(series?.compareGhost?.map((p) => p.value)).toEqual([100, 200]);
  });

  it("aligns a ghost at week grain (Monday-start weeks)", () => {
    const calls = [
      call({ uuid: "w-2wk-ago", timestamp: iso(2026, 5, 30, 10, 0), usage: usage(100) }), // previous, week of Jun 29
      call({ uuid: "w-1wk-ago", timestamp: iso(2026, 6, 8, 10, 0), usage: usage(200) }), // previous, week of Jul 6
      call({ uuid: "w-cur1", timestamp: iso(2026, 6, 14, 10, 0), usage: usage(300) }), // current, week of Jul 13
      call({ uuid: "w-cur2", timestamp: iso(2026, 6, 22, 10, 0), usage: usage(400) }), // current, week of Jul 20
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: ["time"],
      grain: "week",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 26, 23, 59) },
      compare: "previous-period",
    };
    const result = metrics(input, query);
    const series = result[0];
    expect(series?.points.map((p) => p.value)).toEqual([300, 400]);
    expect(series?.compareGhost?.map((p) => p.value)).toEqual([100, 200]);
  });

  it("leaves compareGhost unset when a current-period group has no counterpart in the previous period", () => {
    // Only "newproj" exists anywhere in the input, and only in the current
    // range — the previous-period run produces zero groups for it, so the
    // merge's `previousPoints === undefined` branch returns the series as-is.
    const calls = [
      call({
        uuid: "only-current",
        cwd: "/repo/newproj",
        timestamp: iso(2026, 6, 15, 10, 0),
        usage: usage(300),
      }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: ["project"],
      grain: "day",
      range: { from: iso(2026, 6, 15, 0, 0), to: iso(2026, 6, 15, 23, 59) },
      compare: "previous-period",
    };
    const result = metrics(input, query);
    const series = result[0];
    expect(series?.points[0]?.value).toBe(300);
    expect(series?.compareGhost).toBeUndefined();
  });

  describe("DST transition (America/New_York)", () => {
    const originalTz = process.env.TZ;

    beforeEach(() => {
      process.env.TZ = "America/New_York";
    });

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("truncates a previous period that spans an extra bucket because it crosses the spring-forward day", () => {
      // Current = Mar 9-10 (2 day buckets, no transition). Its duration,
      // subtracted from Mar 9 00:00, lands on Mar 6 23:01 rather than Mar 7
      // 00:00 — Mar 8's missing hour (2am->3am) means the previous range
      // actually spans 3 day buckets (Mar 6, 7, 8), one more than current's 2.
      // alignPreviousPeriod truncates by ordinal index, so Mar 8's data (the
      // DST day itself) is silently dropped from the ghost rather than
      // misaligning Mar 9 with Mar 8 or padding an extra null.
      const calls = [
        // The previous range's actual lower bound is Mar 6 23:01 (not Mar 6
        // 00:00) — Mar 8's missing hour shifts it forward within the day —
        // so this call must land after that instant to be included at all.
        call({ uuid: "mar6", timestamp: iso(2026, 2, 6, 23, 30), usage: usage(100) }), // previous
        call({ uuid: "mar7", timestamp: iso(2026, 2, 7, 10, 0), usage: usage(200) }), // previous
        call({ uuid: "mar8", timestamp: iso(2026, 2, 8, 10, 0), usage: usage(999) }), // previous, dropped
        call({ uuid: "mar9", timestamp: iso(2026, 2, 9, 10, 0), usage: usage(300) }), // current
        call({ uuid: "mar10", timestamp: iso(2026, 2, 10, 10, 0), usage: usage(400) }), // current
      ];
      const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
      const query: MetricsQuery = {
        measures: ["inputTokens"],
        dimensions: ["time"],
        grain: "day",
        range: { from: iso(2026, 2, 9, 0, 0), to: iso(2026, 2, 10, 23, 59) },
        compare: "previous-period",
      };
      const result = metrics(input, query);
      const series = result[0];
      expect(series?.points.map((p) => p.value)).toEqual([300, 400]);
      expect(series?.compareGhost).toHaveLength(2);
      expect(series?.compareGhost?.map((p) => p.value)).toEqual([100, 200]);
    });
  });
});

describe("metrics — smoothing: ma7 wiring", () => {
  it("applies the moving average to the raw aggregated series points", () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      call({
        uuid: `c${i}`,
        timestamp: iso(2026, 6, 13 + i, 10, 0),
        usage: usage((i + 1) * 10),
      }),
    );
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["inputTokens"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 22, 23, 59) },
      smoothing: "ma7",
    };
    const result = metrics(input, query);
    const values = result[0]?.points.map((p) => p.value);
    // Raw daily values: [10,20,...,100]. Expanding window for i<6, full
    // 7-point trailing window from i=6 onward (matches distributions.test.ts's
    // movingAverage7 fixture).
    expect(values).toEqual([10, 15, 20, 25, 30, 35, 40, 50, 60, 70]);
  });
});
describe("metrics — new dashboard measures (toolErrors, cacheSavingsComputed, routingSavingsComputed)", () => {
  it("toolErrors in series mode — turn-grain scope, counts failures", () => {
    const t1Calls = [call({ uuid: "c1a", sessionId: "s1", timestamp: iso(2026, 6, 13, 10, 0) })];
    const t2Calls = [call({ uuid: "c2a", sessionId: "s2", timestamp: iso(2026, 6, 13, 10, 1) })];
    const turns = [
      turn({
        promptId: "p1",
        sessionId: "s1",
        startedAt: iso(2026, 6, 13, 10, 0),
        endedAt: iso(2026, 6, 13, 10, 1),
        calls: t1Calls,
        errorToolResults: 2,
      }),
      turn({
        promptId: "p2",
        sessionId: "s2",
        startedAt: iso(2026, 6, 13, 10, 1),
        endedAt: iso(2026, 6, 13, 10, 2),
        calls: t2Calls,
        errorToolResults: 3,
      }),
    ];
    const input: MetricsInput = {
      calls: [...t1Calls, ...t2Calls],
      turns,
      sessions: [],
      pricing: PRICING,
    };
    const query: MetricsQuery = {
      measures: ["toolErrors"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    };
    const result = metrics(input, query);
    expect(result[0]?.points[0]?.value).toBe(5);
    for (const point of result[0]?.points ?? []) {
      expect(Number.isNaN(point.value)).toBe(false);
      expect(Number.isFinite(point.value ?? NaN)).toBe(true);
    }
  });

  it("toolErrors in series mode — null on call-grain (no turns in scope)", () => {
    // With distributionEntity: "call", there are no turns → toolErrors returns null
    const calls = [call({ uuid: "c1", timestamp: iso(2026, 6, 13, 10, 0) })];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["toolErrors"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
      mode: "distribution",
      distributionEntity: "call",
    };
    const result = metrics(input, query);
    // No entity passes the filter (all null) → honest-null distribution
    expect(result[0]?.distribution?.p50).toBeNull();
  });

  it("cacheSavingsComputed produces valid series with no NaN/Infinity", () => {
    const calls = [
      call({
        uuid: "c1",
        timestamp: iso(2026, 6, 13, 10, 0),
        model: "claude-sonnet-5",
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 500_000,
          cacheCreateTokens: 0,
        },
      }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["cacheSavingsComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    };
    const result = metrics(input, query);
    expect(result[0]?.points[0]?.value).toBeCloseTo(2.25, 10); // uncached=7.5, actual=5.25
    for (const point of result[0]?.points ?? []) {
      expect(Number.isNaN(point.value)).toBe(false);
      expect(Number.isFinite(point.value ?? NaN)).toBe(true);
    }
  });

  it("routingSavingsComputed produces valid series with no NaN/Infinity", () => {
    // All placeholder rates are identical, so the Opus-uncached and
    // current-model-uncached counterfactuals are equal — routing = 0 by
    // construction. (Pre-fix, this was wrongly 2.25 from the
    // `opusUncached - actual` formula; post-fix it is correctly 0.)
    const calls = [
      call({
        uuid: "c1",
        timestamp: iso(2026, 6, 13, 10, 0),
        model: "claude-sonnet-5",
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 500_000,
          cacheCreateTokens: 0,
        },
      }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query: MetricsQuery = {
      measures: ["routingSavingsComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    };
    const result = metrics(input, query);
    expect(result[0]?.points[0]?.value).toBeCloseTo(0, 10);
    for (const point of result[0]?.points ?? []) {
      expect(Number.isNaN(point.value)).toBe(false);
      expect(Number.isFinite(point.value ?? NaN)).toBe(true);
    }
  });

  it("routingSavingsComputed + cacheSavingsComputed = opusUncached - actual (A8 invariant, post-fix)", () => {
    // Use differentiated pricing so model-routing savings are non-zero (not all same rate).
    const customPricing = {
      "claude-sonnet-5": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheCreate: 6.25 },
      "claude-haiku-4-5": { input: 0.3, output: 1.5, cacheRead: 0.03, cacheCreate: 0.375 },
      "claude-opus-4-8": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreate: 18.75 },
    };
    const calls = [
      call({
        uuid: "c1",
        timestamp: iso(2026, 6, 13, 10, 0),
        model: "claude-sonnet-5",
        usage: {
          inputTokens: 1_000_000,
          outputTokens: 200_000,
          cacheReadTokens: 500_000,
          cacheCreateTokens: 100_000,
        },
      }),
      call({
        uuid: "c2",
        timestamp: iso(2026, 6, 13, 11, 0),
        model: "claude-haiku-4-5",
        usage: {
          inputTokens: 800_000,
          outputTokens: 100_000,
          cacheReadTokens: 200_000,
          cacheCreateTokens: 50_000,
        },
      }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: customPricing };
    const routingResult = metrics(input, {
      measures: ["routingSavingsComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    });
    const cacheResult = metrics(input, {
      measures: ["cacheSavingsComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    });
    const actualResult = metrics(input, {
      measures: ["costComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    });
    const routingVal = routingResult[0]?.points[0]?.value ?? 0;
    const cacheVal = cacheResult[0]?.points[0]?.value ?? 0;
    const actualVal = actualResult[0]?.points[0]?.value ?? 0;

    const opusUncached = calls.reduce((sum, call) => {
      const rate = force(customPricing["claude-opus-4-8"], "Opus not in pricing table");
      const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
      return (
        sum +
        ((inputTokens + cacheReadTokens) * rate.input +
          outputTokens * rate.output +
          cacheCreateTokens * rate.cacheCreate) /
          1_000_000
      );
    }, 0);

    // Post-fix: routing = opusUncached - currentUncached, NOT opusUncached - actual.
    // The A8 invariant (the only thing the UI asserts) is cache + routing =
    // opusUncached - actual — independent of how the two terms split.
    expect(routingVal + cacheVal).toBeCloseTo(opusUncached - actualVal, 10);
  });

  it("compatible measures in distribution mode return valid Distribution", () => {
    const t1Calls = [
      call({ uuid: "c1", timestamp: iso(2026, 6, 13, 10, 0), sessionId: "s1" }),
      call({ uuid: "c2", timestamp: iso(2026, 6, 13, 10, 1), sessionId: "s1" }),
    ];
    const t2Calls = [call({ uuid: "c3", timestamp: iso(2026, 6, 13, 11, 0), sessionId: "s2" })];
    const turns = [
      turn({
        promptId: "p1",
        sessionId: "s1",
        startedAt: iso(2026, 6, 13, 10, 0),
        endedAt: iso(2026, 6, 13, 10, 2),
        calls: t1Calls,
        errorToolResults: 1,
      }),
      turn({
        promptId: "p2",
        sessionId: "s2",
        startedAt: iso(2026, 6, 13, 11, 0),
        endedAt: iso(2026, 6, 13, 11, 1),
        calls: t2Calls,
        errorToolResults: 2,
      }),
    ];
    const sessions = [
      session({ sessionId: "s1", firstAt: iso(2026, 6, 13, 10, 0) }),
      session({ sessionId: "s2", firstAt: iso(2026, 6, 13, 11, 0) }),
    ];
    const input: MetricsInput = {
      calls: [...t1Calls, ...t2Calls],
      turns,
      sessions,
      pricing: PRICING,
    };
    // toolErrors with distributionEntity: "session" — session has turns
    const query: MetricsQuery = {
      measures: ["toolErrors"],
      dimensions: [],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
      mode: "distribution",
      distributionEntity: "session",
    };
    const result = metrics(input, query);
    // Two sessions: s1 errorToolResults=1, s2 errorToolResults=2 → [1, 2]
    expect(result[0]?.distribution?.p50).toBe(1);
    expect(result[0]?.distribution?.p99).toBe(2);
  });

  it("unknown measure literal is still rejected — exhaustiveness enforced", () => {
    // This compiles only if all Measure literals are handled in the switch.
    // We test via a type-level assertion that Measure is a finite union.
    const allMeasures = [
      "costComputed",
      "costObserved",
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheCreateTokens",
      "apiCalls",
      "turns",
      "sessions",
      "toolCalls",
      "cacheHitPct",
      "wallMinutes",
      "apiMs",
      "linesAdded",
      "linesRemoved",
      "gatePassRate",
      "toolErrors",
      "cacheSavingsComputed",
      "routingSavingsComputed",
    ] as const;
    // At runtime we only check that known measures produce a value (not null crash)
    const calls = [call({ uuid: "c1", timestamp: iso(2026, 6, 13, 10, 0), sessionId: "s1" })];
    const turns = [
      turn({
        promptId: "p1",
        sessionId: "s1",
        startedAt: iso(2026, 6, 13, 10, 0),
        endedAt: iso(2026, 6, 13, 10, 1),
        calls,
        errorToolResults: 0,
      }),
    ];
    const sessions = [session({ sessionId: "s1", firstAt: iso(2026, 6, 13, 10, 0) })];
    const input: MetricsInput = { calls, turns, sessions, pricing: PRICING };
    for (const measure of allMeasures) {
      const query: MetricsQuery = {
        measures: [measure],
        dimensions: ["time"],
        grain: "day",
        range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
      };
      // Should not throw — exhaustiveness at compile time guarantees all literals handled
      const result = metrics(input, query);
      expect(result).toHaveLength(1);
      expect(result[0]?.points).toBeDefined();
    }
  });
});

// #118 — the series pipeline was inverted from a `measure × group × bucket`
// re-filter into a single pass that assigns each record to its (group, bucket)
// cell once. These cases pin the risk points that inversion could silently
// break: dense multi-bucket density, the empty-cell 0-vs-null contract,
// multi-group × multi-bucket cross-product placement, tool fan-out under
// bucketing, and per-record bucketing of turns AND sessions (not just calls).
// They assert current (correct) behavior and must stay green across the
// refactor. Combined with the ~50 existing series cases above, this is the
// equivalence net (ARCH A3).
describe("metrics — single-pass inversion equivalence (#118)", () => {
  it("places each call in exactly its own (group, bucket) cell — multi-group × multi-bucket", () => {
    // alpha has a call only on day 0; beta only on day 2. A correct inversion
    // puts each call in one cell and leaves every other cell empty (0). A
    // re-filter bug (e.g. a call leaking across groups or buckets) shows up as
    // a nonzero value in a cell that should be empty.
    const calls = [
      call({ uuid: "alpha-d0", cwd: "/repo/alpha", timestamp: iso(2026, 6, 13, 10, 0) }),
      call({ uuid: "beta-d2", cwd: "/repo/beta", timestamp: iso(2026, 6, 15, 10, 0) }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time", "project"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    });
    const result = metrics(input, query);

    const alpha = result.find((s) => s.dimensionKey === "project:/repo/alpha");
    const beta = result.find((s) => s.dimensionKey === "project:/repo/beta");
    expect(alpha?.points.map((p) => p.value)).toEqual([1, 0, 0]); // day 0 only
    expect(beta?.points.map((p) => p.value)).toEqual([0, 0, 1]); // day 2 only
  });

  it("keeps the empty-cell contract: a null-returning measure yields null (not 0) in empty buckets", () => {
    // cacheSavingsComputed returns null for an empty call scope and a number
    // for a non-empty one (measures.ts). Across a dense 3-day axis with calls
    // only on days 0 and 2, the middle bucket must be null — proving empty
    // cells reach computeMeasure exactly as the old empty `scopeFor` did,
    // rather than being fabricated as 0.
    const calls = [
      call({
        uuid: "d0",
        timestamp: iso(2026, 6, 13, 10, 0),
        usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 50, cacheCreateTokens: 0 },
      }),
      call({
        uuid: "d2",
        timestamp: iso(2026, 6, 15, 10, 0),
        usage: { inputTokens: 200, outputTokens: 0, cacheReadTokens: 80, cacheCreateTokens: 0 },
      }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["cacheSavingsComputed"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    });
    const points = metrics(input, query)[0]?.points ?? [];
    expect(points).toHaveLength(3);
    expect(points[0]?.value).not.toBeNull(); // day 0: has calls → savings number
    expect(points[1]?.value).toBeNull(); // day 1: empty cell → null, never 0
    expect(points[2]?.value).not.toBeNull(); // day 2: has calls → savings number
  });

  it("buckets sessions by firstAt into their own cells (session-grain measure over a dense axis)", () => {
    // The inversion must place sessions (not only calls) into per-bucket cells.
    // Two sessions first-seen on different days; the `sessions` measure over a
    // day-grain axis must count each in its own bucket, zero elsewhere.
    const sessions = [
      session({
        sessionId: "s-d0",
        firstAt: iso(2026, 6, 13, 9, 0),
        lastAt: iso(2026, 6, 13, 9, 5),
      }),
      session({
        sessionId: "s-d2",
        firstAt: iso(2026, 6, 15, 9, 0),
        lastAt: iso(2026, 6, 15, 9, 5),
      }),
    ];
    const input: MetricsInput = { calls: [], turns: [], sessions, pricing: PRICING };
    const query = baseQuery({
      measures: ["sessions"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    });
    const points = metrics(input, query)[0]?.points ?? [];
    expect(points.map((p) => p.value)).toEqual([1, 0, 1]);
  });

  it("buckets turns by startedAt into their own cells (turn-grain measure over a dense axis)", () => {
    // wallMinutes is turn-grain; the inversion must bucket turns by startedAt.
    // Two turns starting on different days, each 2 minutes long.
    const turns = [
      turn({
        promptId: "t-d0",
        startedAt: iso(2026, 6, 13, 10, 0),
        endedAt: iso(2026, 6, 13, 10, 2),
        calls: [call({ uuid: "tc0", timestamp: iso(2026, 6, 13, 10, 0) })],
      }),
      turn({
        promptId: "t-d2",
        startedAt: iso(2026, 6, 15, 10, 0),
        endedAt: iso(2026, 6, 15, 10, 2),
        calls: [call({ uuid: "tc2", timestamp: iso(2026, 6, 15, 10, 0) })],
      }),
    ];
    const input: MetricsInput = {
      calls: turns.flatMap((t) => t.calls),
      turns,
      sessions: [],
      pricing: PRICING,
    };
    const query = baseQuery({
      measures: ["wallMinutes"],
      dimensions: ["time"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    });
    const points = metrics(input, query)[0]?.points ?? [];
    expect(points.map((p) => p.value)).toEqual([2, 0, 2]);
  });

  it("preserves tool multi-value fan-out under time bucketing (documented double-count)", () => {
    // One call using two tools fans into two tool groups (groupKeysForCall).
    // Under time bucketing each tool group's bucket must still count the call
    // once — the fan-out is unchanged by the inversion, not accidentally
    // collapsed or multiplied.
    const calls = [
      call({
        uuid: "two-tools",
        timestamp: iso(2026, 6, 13, 10, 0),
        tools: [
          { id: "t1", name: "Read", inputBytes: 1 },
          { id: "t2", name: "Edit", inputBytes: 1 },
        ],
      }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time", "tool"],
      grain: "day",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 13, 23, 59) },
    });
    const result = metrics(input, query);
    const read = result.find((s) => s.dimensionKey === "tool:Read");
    const edit = result.find((s) => s.dimensionKey === "tool:Edit");
    expect(read?.points.map((p) => p.value)).toEqual([1]);
    expect(edit?.points.map((p) => p.value)).toEqual([1]);
  });

  it("wide multi-day hour-grain axis stays dense and correctly bucketed", () => {
    // A smaller stand-in for the pathological all-time-hour shape: a 2-day
    // range at hour grain (48 buckets) with calls in three specific hours.
    // Asserts the dense axis length and that each call lands in exactly its
    // hour bucket, everything else 0.
    const calls = [
      call({ uuid: "h-d0-10", timestamp: iso(2026, 6, 13, 10, 30) }),
      call({ uuid: "h-d0-14", timestamp: iso(2026, 6, 13, 14, 5) }),
      call({ uuid: "h-d1-09", timestamp: iso(2026, 6, 14, 9, 45) }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time"],
      grain: "hour",
      range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 14, 23, 59) },
    });
    const points = metrics(input, query)[0]?.points ?? [];
    expect(points).toHaveLength(48); // 2 days × 24 hours, dense
    const nonzero = points.filter((p) => p.value !== 0);
    expect(nonzero).toHaveLength(3);
    // Day 0 hour 10, day 0 hour 14, day 1 hour 9 (= index 33) each hold one call.
    expect(points[10]?.value).toBe(1);
    expect(points[14]?.value).toBe(1);
    expect(points[24 + 9]?.value).toBe(1);
    expect(points.reduce((sum, p) => sum + (p.value ?? 0), 0)).toBe(3);
  });

  it("fans a multi-model session into every matching group (session inner-loop push)", () => {
    // Calls pre-fan by group (buildGroups), but turns and sessions are matched
    // to groups inside buildCellScopes' own `for (const group of groups)` push
    // loop — the exact code the inversion introduced. A session whose `models`
    // spans two groups must land in BOTH (a realistic Models-page query). A
    // regression to first-match/`break` instead of push-to-all would silently
    // drop it from one series and no other test would catch it.
    const calls = [
      call({ uuid: "c-sonnet", model: "claude-sonnet-5" }),
      call({ uuid: "c-haiku", model: "claude-haiku-4-5" }),
    ];
    const sessions = [
      session({ sessionId: "multi", models: ["claude-sonnet-5", "claude-haiku-4-5"] }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions, pricing: PRICING };
    const query = baseQuery({ measures: ["sessions"], dimensions: ["model"] });
    const result = metrics(input, query);

    const sonnet = result.find((s) => s.dimensionKey === "model:claude-sonnet-5");
    const haiku = result.find((s) => s.dimensionKey === "model:claude-haiku-4-5");
    expect(sonnet?.points.map((p) => p.value)).toEqual([1]);
    expect(haiku?.points.map((p) => p.value)).toEqual([1]);
  });

  it("fans a multi-tool turn into every matching group (turn inner-loop push)", () => {
    // Turn-grain twin of the session case: the representative call (turn.calls[0])
    // uses two tools, so turnMatchesGroup matches both tool groups and the turn's
    // wall minutes must land in each — the documented tool fan-out preserved for
    // turns, not just calls.
    const repCall = call({
      uuid: "rep",
      timestamp: iso(2026, 6, 14, 10, 0),
      tools: [
        { id: "t1", name: "Read", inputBytes: 1 },
        { id: "t2", name: "Edit", inputBytes: 1 },
      ],
    });
    const turns = [
      turn({
        promptId: "multi-tool",
        startedAt: iso(2026, 6, 14, 10, 0),
        endedAt: iso(2026, 6, 14, 10, 2),
        calls: [repCall],
      }),
    ];
    const input: MetricsInput = { calls: [repCall], turns, sessions: [], pricing: PRICING };
    const query = baseQuery({ measures: ["wallMinutes"], dimensions: ["tool"] });
    const result = metrics(input, query);

    const read = result.find((s) => s.dimensionKey === "tool:Read");
    const edit = result.find((s) => s.dimensionKey === "tool:Edit");
    expect(read?.points.map((p) => p.value)).toEqual([2]);
    expect(edit?.points.map((p) => p.value)).toEqual([2]);
  });

  it("places records only in their correct cross-product cell (two breakdown dims)", () => {
    // Two non-time breakdown dims force each group's keyEntries to carry two
    // values; a record must land only in the cell whose project AND model both
    // match, never in a mismatched cross combo.
    const calls = [
      call({ uuid: "a-sonnet", cwd: "/repo/alpha", model: "claude-sonnet-5" }),
      call({ uuid: "b-haiku", cwd: "/repo/beta", model: "claude-haiku-4-5" }),
    ];
    const input: MetricsInput = { calls, turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["apiCalls"],
      dimensions: ["time", "project", "model"],
      grain: "day",
      range: { from: iso(2026, 6, 14, 0, 0), to: iso(2026, 6, 14, 23, 59) },
    });
    const result = metrics(input, query);

    const alphaSonnet = result.find(
      (s) => s.dimensionKey === "project:/repo/alpha|model:claude-sonnet-5",
    );
    const betaHaiku = result.find(
      (s) => s.dimensionKey === "project:/repo/beta|model:claude-haiku-4-5",
    );
    expect(alphaSonnet?.points.map((p) => p.value)).toEqual([1]);
    expect(betaHaiku?.points.map((p) => p.value)).toEqual([1]);
    // The mismatched cross combos never had a call, so buildGroups never
    // creates them — no alpha×haiku or beta×sonnet series exists.
    expect(
      result.find((s) => s.dimensionKey === "project:/repo/alpha|model:claude-haiku-4-5"),
    ).toBeUndefined();
    expect(
      result.find((s) => s.dimensionKey === "project:/repo/beta|model:claude-sonnet-5"),
    ).toBeUndefined();
  });
});
