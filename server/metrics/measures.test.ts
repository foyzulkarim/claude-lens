import { describe, expect, it } from "vitest";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { DEFAULT_PRICING_TABLE, type MeasureScope, computeMeasure } from "./measures.js";

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: "u1",
    sessionId: "s1",
    messageId: "m1",
    timestamp: "2026-07-14T10:00:00.000Z",
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
    startedAt: "2026-07-14T10:00:00.000Z",
    endedAt: "2026-07-14T10:01:00.000Z",
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
    firstAt: "2026-07-14T10:00:00.000Z",
    lastAt: "2026-07-14T10:01:00.000Z",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    turnCount: 1,
    callCount: 1,
    costComputed: 0,
    cacheHitPct: 0,
    ...overrides,
  };
}

const EMPTY_SCOPE: MeasureScope = { calls: [], turns: [], sessions: [] };

describe("computeMeasure — token and count measures", () => {
  it("sums input/output/cache-read/cache-write tokens across scope", () => {
    const scope: MeasureScope = {
      calls: [
        call({
          usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheCreateTokens: 2 },
        }),
        call({
          usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 15, cacheCreateTokens: 8 },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("inputTokens", scope, DEFAULT_PRICING_TABLE)).toBe(300);
    expect(computeMeasure("outputTokens", scope, DEFAULT_PRICING_TABLE)).toBe(30);
    expect(computeMeasure("cacheReadTokens", scope, DEFAULT_PRICING_TABLE)).toBe(20);
    expect(computeMeasure("cacheCreateTokens", scope, DEFAULT_PRICING_TABLE)).toBe(10);
  });

  it("counts calls, turns, and sessions in scope", () => {
    const scope: MeasureScope = {
      calls: [call(), call(), call()],
      turns: [turn(), turn()],
      sessions: [session()],
    };
    expect(computeMeasure("apiCalls", scope, DEFAULT_PRICING_TABLE)).toBe(3);
    expect(computeMeasure("turns", scope, DEFAULT_PRICING_TABLE)).toBe(2);
    expect(computeMeasure("sessions", scope, DEFAULT_PRICING_TABLE)).toBe(1);
  });

  it("counts total tool invocations, not distinct tools", () => {
    const scope: MeasureScope = {
      calls: [
        call({
          tools: [
            { name: "Read", inputBytes: 1 },
            { name: "Read", inputBytes: 1 },
          ],
        }),
        call({ tools: [{ name: "Bash", inputBytes: 1 }] }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("toolCalls", scope, DEFAULT_PRICING_TABLE)).toBe(3);
  });

  it("computes cache hit percentage matching derive-session.ts's formula", () => {
    const scope: MeasureScope = {
      calls: [
        call({
          usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 50, cacheCreateTokens: 50 },
        }),
      ],
      turns: [],
      sessions: [],
    };
    // cacheRead / (input + cacheRead + cacheCreate) = 50 / 200
    expect(computeMeasure("cacheHitPct", scope, DEFAULT_PRICING_TABLE)).toBe(0.25);
  });

  it("cacheHitPct is 0 when no cache-eligible tokens exist, not NaN/null", () => {
    const scope: MeasureScope = { calls: [call()], turns: [], sessions: [] };
    expect(computeMeasure("cacheHitPct", scope, DEFAULT_PRICING_TABLE)).toBe(0);
  });
});

describe("computeMeasure — cost measures", () => {
  it("costComputed sums usage x pricing table rates", () => {
    const pricing = {
      "claude-sonnet-5": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
    };
    const scope: MeasureScope = {
      calls: [
        call({
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 1_000_000,
            cacheCreateTokens: 1_000_000,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    // 1M tokens of each type at the given per-1M rates: 5 + 25 + 0.5 + 6.25 = 36.75
    expect(computeMeasure("costComputed", scope, pricing)).toBeCloseTo(36.75, 10);
  });

  it("an unpriced model contributes $0, not NaN/throw", () => {
    const scope: MeasureScope = {
      calls: [
        call({
          model: "some-unknown-model",
          usage: {
            inputTokens: 1000,
            outputTokens: 1000,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("costComputed", scope, DEFAULT_PRICING_TABLE)).toBe(0);
  });

  it("DEFAULT_PRICING_TABLE covers the four known models with the placeholder legacy rates", () => {
    for (const model of [
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-haiku-4-5",
    ]) {
      expect(DEFAULT_PRICING_TABLE[model]).toEqual({
        input: 5.0,
        output: 25.0,
        cacheRead: 0.5,
        cacheCreate: 6.25,
      });
    }
  });
});

describe("computeMeasure — wallMinutes (real today, not premium-gated)", () => {
  it("sums (endedAt - startedAt) across scope turns, in minutes", () => {
    const scope: MeasureScope = {
      calls: [],
      turns: [
        turn({ startedAt: "2026-07-14T10:00:00.000Z", endedAt: "2026-07-14T10:02:00.000Z" }),
        turn({ startedAt: "2026-07-14T11:00:00.000Z", endedAt: "2026-07-14T11:00:30.000Z" }),
      ],
      sessions: [],
    };
    expect(computeMeasure("wallMinutes", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(2.5, 10);
  });

  it("skips a turn with an unparseable startedAt/endedAt instead of poisoning the sum with NaN (review finding H1)", () => {
    const scope: MeasureScope = {
      calls: [],
      turns: [
        turn({ startedAt: "2026-07-14T10:00:00.000Z", endedAt: "2026-07-14T10:02:00.000Z" }),
        turn({ startedAt: "", endedAt: "2026-07-14T11:00:30.000Z" }),
      ],
      sessions: [],
    };
    const value = computeMeasure("wallMinutes", scope, DEFAULT_PRICING_TABLE);
    expect(value).toBe(2);
    expect(Number.isNaN(value)).toBe(false);
  });
});

describe("computeMeasure — premium-gated measures return null today", () => {
  it.each([
    "costObserved",
    "linesAdded",
    "linesRemoved",
    "gatePassRate",
    "apiMs",
  ] as const)("%s returns null regardless of scope contents", (measure) => {
    const scope: MeasureScope = { calls: [call()], turns: [turn()], sessions: [session()] };
    expect(computeMeasure(measure, scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });
});

describe("computeMeasure — empty scope", () => {
  it("activity measures are 0 for an empty scope", () => {
    for (const measure of [
      "apiCalls",
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheCreateTokens",
      "costComputed",
      "toolCalls",
      "turns",
      "sessions",
      "cacheHitPct",
      "wallMinutes",
    ] as const) {
      const value = computeMeasure(measure, EMPTY_SCOPE, DEFAULT_PRICING_TABLE);
      expect(value).toBe(0);
    }
  });

  it("premium measures are null for an empty scope", () => {
    for (const measure of [
      "costObserved",
      "linesAdded",
      "linesRemoved",
      "gatePassRate",
      "apiMs",
    ] as const) {
      expect(computeMeasure(measure, EMPTY_SCOPE, DEFAULT_PRICING_TABLE)).toBeNull();
    }
  });
});
