import { describe, expect, it } from "vitest";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import {
  DEFAULT_PRICING_TABLE,
  uncachedPrice,
  type MeasureScope,
  computeMeasure,
} from "./measures.js";

/** Asserts a value is non-null; throws with the given message otherwise. Used to
 * satisfy Biome's noNonNullAssertion rule when we *know* a fixture produces a
 * real value (test is the contract, not production). */
function force<T>(v: T | null | undefined, msg: string): T {
  if (v == null) throw new Error(msg);
  return v;
}

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
describe("computeMeasure — toolErrors", () => {
  it("sums errorToolResults across scope turns", () => {
    const scope: MeasureScope = {
      calls: [],
      turns: [
        turn({ errorToolResults: 1 }),
        turn({ errorToolResults: 2 }),
        turn({ errorToolResults: 0 }),
      ],
      sessions: [],
    };
    expect(computeMeasure("toolErrors", scope, DEFAULT_PRICING_TABLE)).toBe(3);
  });

  it("returns null for a call-grain scope (no turns)", () => {
    const scope: MeasureScope = {
      calls: [call()],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("toolErrors", scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });

  it("zero errorToolResults is a real 0, not null", () => {
    const scope: MeasureScope = {
      calls: [],
      turns: [turn({ errorToolResults: 0 })],
      sessions: [],
    };
    expect(computeMeasure("toolErrors", scope, DEFAULT_PRICING_TABLE)).toBe(0);
    expect(computeMeasure("toolErrors", scope, DEFAULT_PRICING_TABLE)).not.toBeNull();
  });

  it("undefined errorToolResults is treated as 0", () => {
    const scope: MeasureScope = {
      calls: [],
      turns: [turn({ errorToolResults: undefined })],
      sessions: [],
    };
    expect(computeMeasure("toolErrors", scope, DEFAULT_PRICING_TABLE)).toBe(0);
  });
});

describe("computeMeasure — cacheSavingsComputed", () => {
  it("computes (uncached cost) - (actual cost) correctly", () => {
    // Rates: input=5, output=25, cacheRead=0.5, cacheCreate=6.25
    // Call: 1M input, 1M cacheRead, 0 output, 0 cacheCreate
    // uncached = (1M+1M)*5/1M = 10
    // actual   = 1M*5/1M + 1M*0.5/1M = 5 + 0.5 = 5.5
    // savings  = 10 - 5.5 = 4.5
    const scope: MeasureScope = {
      calls: [
        call({
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("cacheSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      4.5,
      10,
    );
  });

  it("matches hand-rolled expectations on a mixed call", () => {
    // Rates: input=5, output=25, cacheRead=0.5, cacheCreate=6.25
    // Call: 200k input, 100k output, 80k cacheRead, 20k cacheCreate
    // uncached = (200k+80k)*5/1M + 100k*25/1M + 20k*6.25/1M = 1.4 + 2.5 + 0.125 = 4.025
    // actual   = 200k*5/1M + 100k*25/1M + 80k*0.5/1M + 20k*6.25/1M = 1.0 + 2.5 + 0.04 + 0.125 = 3.665
    // savings  = 4.025 - 3.665 = 0.36
    const scope: MeasureScope = {
      calls: [
        call({
          usage: {
            inputTokens: 200_000,
            outputTokens: 100_000,
            cacheReadTokens: 80_000,
            cacheCreateTokens: 20_000,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("cacheSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      0.36,
      10,
    );
  });

  it("sums across multiple calls", () => {
    const scope: MeasureScope = {
      calls: [
        call({
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreateTokens: 0,
          },
        }),
        call({
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    // Call 1: uncached=10, actual=5.5, savings=4.5
    // Call 2: uncached=5, actual=5, savings=0
    // total = 4.5
    expect(computeMeasure("cacheSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      4.5,
      10,
    );
  });

  it("returns null when any call's model is unpriced", () => {
    const scope: MeasureScope = {
      calls: [
        call({
          model: "unknown-model",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("cacheSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });

  it("returns null for an empty call list", () => {
    const scope: MeasureScope = { calls: [], turns: [], sessions: [] };
    expect(computeMeasure("cacheSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });
});

describe("computeMeasure — routingSavingsComputed", () => {
  it("computes (all-Opus uncached cost) - (actual cost) correctly", () => {
    // Rates: input=5, output=25, cacheRead=0.5, cacheCreate=6.25 (same for all models in placeholder)
    // Call: 1M input, 1M cacheRead, 0 output, 0 cacheCreate
    // opusUncached = (1M+1M)*5/1M = 10
    // actual       = 1M*5/1M + 1M*0.5/1M = 5.5
    // savings      = 10 - 5.5 = 4.5
    const scope: MeasureScope = {
      calls: [
        call({
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 1_000_000,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("routingSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      4.5,
      10,
    );
  });

  it("routing = opusUncached - actual (counterfactual); cache = current_uncached - actual (non-overlapping)", () => {
    // Use explicit pricing where Opus is meaningfully more expensive than Sonnet/Haiku.
    const pricing = {
      "claude-sonnet-5": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheCreate: 6.25 },
      "claude-haiku-4-5": { input: 0.3, output: 1.5, cacheRead: 0.03, cacheCreate: 0.375 },
      "claude-opus-4-8": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreate: 18.75 },
    };
    const scope: MeasureScope = {
      calls: [
        call({
          model: "claude-sonnet-5",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 200_000,
            cacheReadTokens: 500_000,
            cacheCreateTokens: 100_000,
          },
        }),
        call({
          model: "claude-haiku-4-5",
          usage: {
            inputTokens: 800_000,
            outputTokens: 100_000,
            cacheReadTokens: 200_000,
            cacheCreateTokens: 50_000,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };

    const cache = force(
      computeMeasure("cacheSavingsComputed", scope, pricing),
      "cacheSavingsComputed unexpectedly null",
    );
    const routing = force(
      computeMeasure("routingSavingsComputed", scope, pricing),
      "routingSavingsComputed unexpectedly null",
    );
    const actual = force(
      computeMeasure("costComputed", scope, pricing),
      "costComputed unexpectedly null",
    );
    const opusRate = force(pricing["claude-opus-4-8"], "Opus not in pricing table");
    // routing = opusUncached - actual
    const opusUncached = scope.calls.reduce((sum, call) => {
      const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
      return (
        sum +
        ((inputTokens + cacheReadTokens) * opusRate.input +
          outputTokens * opusRate.output +
          cacheCreateTokens * opusRate.cacheCreate) /
          1_000_000
      );
    }, 0);
    const currentUncached = scope.calls.reduce(
      (sum, call) => sum + force(uncachedPrice(call, pricing), "uncachedPrice unexpectedly null"),
      0,
    );
    expect(cache).toBeCloseTo(currentUncached - actual, 10);
    expect(routing).toBeCloseTo(opusUncached - actual, 10);

    // Non-overlapping: cache and routing measure independent counterfactuals
    // Total = (opusUncached - actual) + (currentUncached - actual)
    //       = opusUncached + currentUncached - 2*actual
    // This is NOT equal to opusUncached - actual; they measure different things.
  });

  it("returns null when Opus is not in the pricing table", () => {
    const emptyPricing: typeof DEFAULT_PRICING_TABLE = {};
    const scope: MeasureScope = {
      calls: [
        call({
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("routingSavingsComputed", scope, emptyPricing)).toBeNull();
  });

  it("returns null for an empty call list", () => {
    const scope: MeasureScope = { calls: [], turns: [], sessions: [] };
    expect(computeMeasure("routingSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });

  it("handles a known cheap model vs Opus", () => {
    // Sonnet input=5, Opus input=5 (placeholder). When cache is involved,
    // routing savings come purely from cache vs no-cache on Opus.
    const scope: MeasureScope = {
      calls: [
        call({
          model: "claude-haiku-4-5",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 500_000,
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    // opusUncached = (1M+500k)*5/1M = 7.5
    // actual       = 1M*5/1M + 500k*0.5/1M = 5 + 0.25 = 5.25
    // savings     = 7.5 - 5.25 = 2.25
    expect(computeMeasure("routingSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      2.25,
      10,
    );
  });
});

describe("computeMeasure — premium-gated measures return null today", () => {
  // toolErrors, cacheSavingsComputed, routingSavingsComputed are now implemented
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
