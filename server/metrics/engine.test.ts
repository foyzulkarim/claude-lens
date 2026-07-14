import { describe, expect, it } from "vitest";
import type { MetricsQuery } from "../../shared/metrics-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";
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
});
