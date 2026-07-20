import { describe, expect, it } from "vitest";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import {
  computeMeasure,
  DEFAULT_PRICING_TABLE,
  type MeasureScope,
  uncachedPrice,
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
    host: "default", // review #13: synthetic, mirrors metrics engine
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
      // (#P4-5, A4) `turns` now counts logical prompt turns, so each turn
      // gets a distinct promptId here. Sidechain-only groupings collapse
      // into the parent's logical turn and are covered in their own test.
      turns: [turn({ promptId: "p1" }), turn({ promptId: "p2" })],
      sessions: [session()],
    };
    expect(computeMeasure("apiCalls", scope, DEFAULT_PRICING_TABLE)).toBe(3);
    expect(computeMeasure("turns", scope, DEFAULT_PRICING_TABLE)).toBe(2);
    expect(computeMeasure("sessions", scope, DEFAULT_PRICING_TABLE)).toBe(1);
  });

  it("turns measure groups sidechain segments under their parent prompt", () => {
    const scope: MeasureScope = {
      calls: [],
      // Two derived Turn records sharing promptId="p1" — one main, one
      // sidechain — must collapse to a single logical turn so Session
      // Detail and the dashboard agree.
      turns: [
        turn({ promptId: "p1", isSidechain: false }),
        turn({ promptId: "p1", isSidechain: true }),
        turn({ promptId: "p2", isSidechain: false }),
      ],
      sessions: [],
    };
    expect(computeMeasure("turns", scope, DEFAULT_PRICING_TABLE)).toBe(2);
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

describe("computeMeasure — observed premium measures (#P4-13)", () => {
  it.each([
    "costObserved",
    "linesAdded",
    "linesRemoved",
    "apiMs",
  ] as const)("%s returns null when no call carries observed data", (measure) => {
    const scope: MeasureScope = { calls: [call()], turns: [turn()], sessions: [session()] };
    expect(computeMeasure(measure, scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });

  it("sums observed fields across the scope's calls once reconcile has attributed them", () => {
    const scope: MeasureScope = {
      calls: [
        call({ costObserved: 0.2, apiMs: 1500, linesAdded: 3, linesRemoved: 1 }),
        call({ costObserved: 0.3, apiMs: 2500, linesAdded: 4, linesRemoved: 2 }),
        call(), // transcript-only call contributes nothing, is not counted as a 0
      ],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("costObserved", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(0.5);
    expect(computeMeasure("apiMs", scope, DEFAULT_PRICING_TABLE)).toBe(4000);
    expect(computeMeasure("linesAdded", scope, DEFAULT_PRICING_TABLE)).toBe(7);
    expect(computeMeasure("linesRemoved", scope, DEFAULT_PRICING_TABLE)).toBe(3);
  });

  it("returns a measured 0 (not null) when an observed field is present but zero", () => {
    const scope: MeasureScope = {
      calls: [call({ linesAdded: 0 })],
      turns: [],
      sessions: [],
    };
    expect(computeMeasure("linesAdded", scope, DEFAULT_PRICING_TABLE)).toBe(0);
  });

  it("gatePassRate still returns null without gate summaries", () => {
    const scope: MeasureScope = { calls: [call()], turns: [turn()], sessions: [session()] };
    expect(computeMeasure("gatePassRate", scope, DEFAULT_PRICING_TABLE)).toBeNull();
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
  it("computes (all-Opus uncached) - (current-model uncached) correctly", () => {
    // Post-fix formula (review #1): routing = opusUncached - currentUncached
    // (the "model mix" savings). Pre-fix this was `opusUncached - actual`
    // which double-counted against cacheSavingsComputed.
    //
    // Rates: identical placeholder across all four models, so
    // opusUncached == currentUncached and routing == 0 by construction.
    // The test now pins the "no synthetic Opus-vs-Sonnet gap while
    // placeholder rates remain flat" invariant — once #P4-15 wires
    // per-model rates, this same fixture should produce a non-zero value.
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
    // opusUncached = (1M+1M)*5/1M = 10
    // currentUncached = (1M+1M)*5/1M = 10  (same placeholder rate)
    // routing = opusUncached - currentUncached = 0
    expect(computeMeasure("routingSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      0,
      10,
    );
  });

  it("routing = opusUncached - currentUncached; cache + routing = opusUncached - actual (A8 invariant)", () => {
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
    // routing now = opusUncached - currentUncached (the "model mix" savings,
    // NOT opusUncached - actual — review finding #1). cache + routing must
    // sum to the A8 invariant opusUncached - actual exactly, no double count.
    expect(routing).toBeCloseTo(opusUncached - currentUncached, 10);
    expect(cache + routing).toBeCloseTo(opusUncached - actual, 10);
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

  it("handles a known cheap model vs Opus (placeholder rates identical, so routing = 0)", () => {
    // All placeholder rates in DEFAULT_PRICING_TABLE are identical, so the
    // Opus and current-model uncached counterfactuals are equal — the
    // routing-only savings are 0 by construction. Cache savings still
    // (post-fix) reflects only the cache-discount component. This test
    // pins the "no synthetic Opus-vs-Sonnet gap while placeholder rates
    // remain flat" invariant — once #P4-15 wires per-model rates, the
    // same call below should produce a non-zero routing value.
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
    // opusUncached    = (1M+500k)*5/1M = 7.5
    // currentUncached = (1M+500k)*5/1M = 7.5  (same placeholder rate)
    // routing = opusUncached - currentUncached = 0
    // cache = currentUncached - actual = 7.5 - 5.25 = 2.25
    expect(computeMeasure("routingSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      0,
      10,
    );
    expect(computeMeasure("cacheSavingsComputed", scope, DEFAULT_PRICING_TABLE)).toBeCloseTo(
      2.25,
      10,
    );
  });

  it("regression: cache-heavy fixture where the old double-counting formula diverges measurably", () => {
    // Distinct Opus vs current-model rates, large cache_read so the old
    // `opusUncached - actual` and the corrected `opusUncached - currentUncached`
    // formulas differ by the entire cache-savings segment. Pinning this
    // prevents regressing back to the double-counted version (review #1).
    const pricing = {
      "claude-sonnet-5": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheCreate: 6.25 },
      "claude-opus-4-8": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheCreate: 18.75 },
    };
    const scope: MeasureScope = {
      calls: [
        call({
          model: "claude-sonnet-5",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 4_000_000, // large cache component
            cacheCreateTokens: 0,
          },
        }),
      ],
      turns: [],
      sessions: [],
    };
    const opusUncached = ((1_000_000 + 4_000_000) * 15) / 1_000_000; // = 75
    const currentUncached = ((1_000_000 + 4_000_000) * 5) / 1_000_000; // = 25
    const actual = (1_000_000 * 5 + 4_000_000 * 0.5) / 1_000_000; // = 7
    const expectedRouting = opusUncached - currentUncached; // = 50
    const expectedCache = currentUncached - actual; // = 18

    const routing = force(
      computeMeasure("routingSavingsComputed", scope, pricing),
      "routingSavingsComputed unexpectedly null",
    );
    const cache = force(
      computeMeasure("cacheSavingsComputed", scope, pricing),
      "cacheSavingsComputed unexpectedly null",
    );

    // The bug we are guarding against: the old formula returned
    // `opusUncached - actual = 68` here. Lock the new (correct) value.
    expect(routing).toBeCloseTo(expectedRouting, 10);
    expect(cache).toBeCloseTo(expectedCache, 10);
    expect(routing).not.toBeCloseTo(opusUncached - actual, 1); // would be 68, distinct from 50
    // A8 invariant: cache + routing = opusUncached - actual
    expect(cache + routing).toBeCloseTo(opusUncached - actual, 10);
  });
});

describe("computeMeasure — premium-gated measures return null today", () => {
  // toolErrors, cacheSavingsComputed, routingSavingsComputed are now implemented
  it.each([
    "costObserved",
    "linesAdded",
    "linesRemoved",
    "apiMs",
  ] as const)("%s returns null regardless of scope contents", (measure) => {
    const scope: MeasureScope = { calls: [call()], turns: [turn()], sessions: [session()] };
    expect(computeMeasure(measure, scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });
});

describe("computeMeasure — gatePassRate", () => {
  // #P4-12 wired the cache → engine contract so the measure de-nulled
  // once summaries arrive. The earlier "returns null regardless of
  // scope contents" assertion was correct pre-PR but became factually
  // wrong the moment `gateSummaries` started flowing through
  // `MetricsInput`. This block pins the new semantics (#P4-12 review
  // finding #17): mean(score) across sessions with summaries, null
  // when none have a summary, and a single 0 contribution from a
  // "pass" summary (not fabricated from missing data).
  const s = session();

  it("returns the mean of summary scores for sessions in scope", () => {
    const scope: MeasureScope = { calls: [], turns: [], sessions: [s] };
    const gateSummaries = new Map([["s1", { score: 0.6, status: "pass" as const }]]);
    expect(computeMeasure("gatePassRate", scope, DEFAULT_PRICING_TABLE, gateSummaries)).toBe(0.6);
  });

  it("averages across multiple summaries in scope", () => {
    const s2 = { ...s, sessionId: "s2" };
    const scope: MeasureScope = { calls: [], turns: [], sessions: [s, s2] };
    const gateSummaries = new Map([
      ["s1", { score: 0.4, status: "warn" as const }],
      ["s2", { score: 0.8, status: "pass" as const }],
    ]);
    expect(computeMeasure("gatePassRate", scope, DEFAULT_PRICING_TABLE, gateSummaries)).toBeCloseTo(
      0.6,
      10,
    );
  });

  it("returns null when no sessions in scope have a summary", () => {
    const scope: MeasureScope = { calls: [], turns: [], sessions: [s] };
    expect(computeMeasure("gatePassRate", scope, DEFAULT_PRICING_TABLE)).toBeNull();
  });

  it("ignores scope sessions whose summary is absent (never fabricates 0)", () => {
    const sMissing = { ...s, sessionId: "s2" };
    const scope: MeasureScope = { calls: [], turns: [], sessions: [s, sMissing] };
    const gateSummaries = new Map([["s1", { score: 0.6, status: "pass" as const }]]);
    // Only s1 contributes; s2 is in scope but has no summary and is
    // dropped from the mean (not added as 0).
    expect(computeMeasure("gatePassRate", scope, DEFAULT_PRICING_TABLE, gateSummaries)).toBe(0.6);
  });
});
