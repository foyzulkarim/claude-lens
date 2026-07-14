import { describe, expect, it } from "vitest";
import type { MetricsQuery } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { DEFAULT_PRICING_TABLE } from "./measures.js";
import { type MetricsInput, metrics } from "./engine.js";

// All timestamps are built from local Date constructors (never hardcoded
// "...Z" UTC strings) so bucket-day assignment — which truncates by *local*
// calendar day (grain.ts) — is deterministic regardless of the machine
// running the tests.
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

function baseQuery(overrides: Partial<MetricsQuery> = {}): MetricsQuery {
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

  it("mode/compare/smoothing are silently no-op'd, never throw", () => {
    const input: MetricsInput = { calls: [call()], turns: [], sessions: [], pricing: PRICING };
    const query = baseQuery({
      measures: ["costComputed"],
      dimensions: ["time"],
      grain: "day",
      compare: "previous-period",
      smoothing: "ma7",
      mode: "distribution",
    });
    expect(() => metrics(input, query)).not.toThrow();
    const result = metrics(input, query);
    expect(result[0]?.compareGhost).toBeUndefined();
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
