import { describe, expect, it } from "vitest";
import type { MetricsQuery } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { type MetricsInput, metrics } from "./engine.js";
import { DEFAULT_PRICING_TABLE } from "./measures.js";

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
function baseQuery(
  overrides: Partial<Omit<MetricsQuery, "mode" | "distributionEntity">> = {},
): MetricsQuery {
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
