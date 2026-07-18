import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscriptLines } from "../ingest/parse-transcript.js";
import { deriveSession } from "./derive-session.js";
import { deriveTurns } from "./derive-turns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(
  __dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "projects",
  "-Users-demo-project-alpha",
);

function readFixtureLines(filename: string): string[] {
  const content = readFileSync(join(fixturesDir, filename), "utf8");
  return content.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
}

const noSidecars = { hasCostSamples: false, hasTurnBoundaries: false, hasCostLog: false };

describe("deriveSession — fixture-driven rollups", () => {
  it("rolls up models, usage, and counts from the clean multi-turn fixture", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const session = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
    );

    expect(session.callCount).toBe(parsed.calls.length);
    // (#P4-5, A4) turnCount now reflects logical prompt turns — sidechain
    // segments are folded under their parent prompt rather than counted as
    // separate user turns. The fixture has 2 prompts, so the logical count
    // is 2 even though the raw derived-turn array has 3 entries.
    expect(session.turnCount).toBe(2);
    expect(session.models.sort()).toEqual(["claude-fable-5", "claude-sonnet-5"]);
    // Exact totals across all 5 deduped calls in the fixture (computed independently
    // from the raw fixture JSON, not derived from this code) — a stronger check than
    // loose bounds, and consistent with the exact per-turn sums in derive-turns.test.ts.
    expect(session.usage).toMatchObject({
      inputTokens: 4000,
      outputTokens: 200,
      cacheReadTokens: 1200,
      cacheCreateTokens: 5300,
      cacheCreate5m: 300,
      cacheCreate1h: 5000,
    });
    expect(session.cacheHitPct).toBeCloseTo(1200 / (4000 + 1200 + 5300));
  });

  it("defaults costComputed to 0 without a pricer, and applies an injected pricer", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const unpriced = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
    );
    expect(unpriced.costComputed).toBe(0);
    expect(unpriced.tier.costBasis).toBe("computed");

    const flatPricer = (usage: { inputTokens: number }) => usage.inputTokens * 0.001;
    const priced = deriveSession(
      "11111111-1111-4111-8111-111111111111",
      parsed.calls,
      turns,
      noSidecars,
      flatPricer,
    );
    expect(priced.costComputed).toBeGreaterThan(0);
    expect(priced.costComputed).toBeCloseTo(unpriced.usage.inputTokens * 0.001);
  });

  it("carries sidecar presence into tier flags", () => {
    const session = deriveSession("s1", [], [], {
      hasCostSamples: true,
      hasTurnBoundaries: false,
      hasCostLog: true,
    });
    expect(session.tier).toMatchObject({
      hasCostSamples: true,
      hasTurnBoundaries: false,
      hasCostLog: true,
    });
  });

  it("returns a zeroed rollup for a session with no calls", () => {
    const session = deriveSession("empty-session", [], [], noSidecars);
    expect(session.callCount).toBe(0);
    expect(session.turnCount).toBe(0);
    expect(session.usage.inputTokens).toBe(0);
    expect(session.cacheHitPct).toBe(0);
    expect(session.firstAt).toBe("");
    expect(session.durationMs).toBeUndefined();
  });
});
describe("deriveSession — computed field derivation", () => {
  const noSidecars = { hasCostSamples: false, hasTurnBoundaries: false, hasCostLog: false };

  // Simple pricer: $1 per call
  const flatPricer = () => 1;

  // Simple pricing table
  const simplePricing = {
    "claude-sonnet-5": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
  };

  function makeCall(
    messageId: string,
    model = "claude-sonnet-5",
    usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
  ): import("../../shared/types.js").ApiCall {
    return {
      uuid: `u-${messageId}`,
      sessionId: "s1",
      messageId,
      timestamp: "2026-07-13T00:00:00.000Z",
      model,
      usage,
      isSidechain: false,
      tools: [],
      cwd: "/repo",
      gitBranch: "main",
      version: "1.0.0",
      entrypoint: "cli",
    };
  }

  function makeTurn(
    promptId: string,
    calls: import("../../shared/types.js").ApiCall[],
  ): import("../../shared/types.js").Turn {
    return {
      promptId,
      sessionId: "s1",
      isSidechain: false,
      startedAt: "2026-07-13T00:00:00.000Z",
      endedAt: "2026-07-13T00:00:01.000Z",
      calls,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      toolResultBytes: 0,
    };
  }

  it("costComputed > 0 with priced calls", () => {
    const calls = [makeCall("m1")];
    const turns = [makeTurn("p1", calls)];
    const session = deriveSession("s1", calls, turns, noSidecars, flatPricer, simplePricing);
    expect(session.costComputed).toBeGreaterThan(0);
  });

  it("costComputed = 0 with empty pricing table (no pricer injected)", () => {
    const calls = [makeCall("m1")];
    const turns = [makeTurn("p1", calls)];
    const session = deriveSession("s1", calls, turns, noSidecars, undefined, {});
    expect(session.costComputed).toBe(0);
  });

  it("cacheSavingsComputed computed from pricing", () => {
    // With 50% cache read, uncached > actual → positive savings
    const calls = [
      makeCall("m1", "claude-sonnet-5", {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 1000,
        cacheCreateTokens: 0,
      }),
    ];
    const turns = [makeTurn("p1", calls)];
    const session = deriveSession("s1", calls, turns, noSidecars, flatPricer, simplePricing);
    // Cache savings = (uncached - actual)
    // uncached = (1000+1000)*5/1e6 + 100*25/1e6 = 10.0025
    // actual   = 1000*5/1e6 + 1000*0.5/1e6 + 100*25/1e6 = 0.005 + 0.0005 + 0.0025 = 0.008
    // savings  ≈ 0.0025
    expect(session.cacheSavingsComputed).toBeGreaterThan(0);
  });

  it("maxTurnCostComputed is the max per-turn cost", () => {
    // Turn 1: 1 call at $1 = $1, Turn 2: 3 calls at $1 = $3
    const calls1 = [makeCall("m1")];
    const calls2 = [makeCall("m2"), makeCall("m3"), makeCall("m4")];
    const turns = [makeTurn("p1", calls1), makeTurn("p2", calls2)];
    const allCalls = [...calls1, ...calls2];
    const session = deriveSession("s1", allCalls, turns, noSidecars, flatPricer, simplePricing);
    expect(session.maxTurnCostComputed).toBe(3);
  });

  it("contextPctEstimated is in [0, 1] for known model", () => {
    const calls = [
      makeCall("m1", "claude-sonnet-5", {
        inputTokens: 50_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    ];
    const turns = [makeTurn("p1", calls)];
    // Update turn usage to reflect call
    turns[0].usage = { ...calls[0].usage };
    const session = deriveSession("s1", calls, turns, noSidecars, flatPricer, simplePricing);
    expect(session.contextPctEstimated).toBeGreaterThanOrEqual(0);
    expect(session.contextPctEstimated).toBeLessThanOrEqual(1);
  });

  it("contextPctEstimated is undefined for unknown model", () => {
    const calls = [
      makeCall("m1", "claude-unknown-99", {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }),
    ];
    const turns = [makeTurn("p1", calls)];
    turns[0].usage = { ...calls[0].usage };
    const session = deriveSession("s1", calls, turns, noSidecars, flatPricer, simplePricing);
    expect(session.contextPctEstimated).toBeUndefined();
  });

  it("returns a zeroed rollup for a session with no calls", () => {
    const session = deriveSession("empty-session", [], [], noSidecars, flatPricer, simplePricing);
    expect(session.callCount).toBe(0);
    expect(session.turnCount).toBe(0);
    expect(session.usage.inputTokens).toBe(0);
    expect(session.cacheHitPct).toBe(0);
    expect(session.firstAt).toBe("");
    expect(session.durationMs).toBeUndefined();
  });

  it("priced session with zero cache savings returns cacheSavingsComputed: 0 (review #2 regression)", () => {
    // The pre-fix code returned `cacheSavingsComputed > 0 ? value : undefined`,
    // which collapsed a real priced session with genuinely zero cache savings
    // (no cache_read tokens) to "unavailable" — indistinguishable from a
    // session where pricing was never wired up. Project invariant is "0 means
    // measured zero, undefined means unavailable".
    const calls = [
      makeCall("m1", "claude-sonnet-5", {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0, // no cache reads → cache savings are exactly 0
        cacheCreateTokens: 0,
      }),
    ];
    const turns = [makeTurn("p1", calls)];
    const session = deriveSession("s1", calls, turns, noSidecars, flatPricer, simplePricing);
    expect(session.cacheSavingsComputed).toBe(0);
    expect(session.cacheSavingsComputed).not.toBeUndefined();
  });

  it("priced session with one free turn returns maxTurnCostComputed: 0 (review #2 regression)", () => {
    // Symmetric guard: `maxTurnCostComputed > 0 ? value : undefined` had the
    // same defect — a priced session with a single zero-cost turn lost its
    // real "0" to "unavailable". The fix keys off pricer presence.
    const calls = [makeCall("m1")];
    calls[0].usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
    const zeroPricer = () => 0;
    const turns = [makeTurn("p1", calls)];
    turns[0].usage = { ...calls[0].usage };
    const session = deriveSession("s1", calls, turns, noSidecars, zeroPricer, simplePricing);
    expect(session.maxTurnCostComputed).toBe(0);
    expect(session.maxTurnCostComputed).not.toBeUndefined();
  });

  it("unpriced session still returns undefined (review #2 — preserve unavailable signal)", () => {
    // No pricer → both fields stay undefined, matching the pre-fix
    // "unavailable" semantics. The fix must not leak a zero into a session
    // where pricing was never wired up.
    const calls = [makeCall("m1")];
    const turns = [makeTurn("p1", calls)];
    turns[0].usage = { ...calls[0].usage };
    const session = deriveSession("s1", calls, turns, noSidecars, undefined, undefined);
    expect(session.cacheSavingsComputed).toBeUndefined();
    expect(session.maxTurnCostComputed).toBeUndefined();
  });

  it("contextPctEstimated uses the latest call's own usage (review #12 regression)", () => {
    // Pre-fix used `lastTurn.usage` (the aggregate of every call in the
    // final turn). In a tool-loop turn that double-counts overlapping token
    // usage and clamps healthy contexts at 100%. Post-fix selects the
    // latest call BY TIMESTAMP and uses only its own usage.
    //
    // Turn p1: 3 calls with small usage each. The latest by timestamp is
    // m3 (50k input + 10k output). Final aggregate usage is 110k + 30k
    // (summed), which would clamp a 200k-window session at ~70%.
    // The post-fix value is 50k + 10k = 60k / 200k = 0.30 (30%).
    const call1 = {
      ...makeCall("m1"),
      timestamp: "2026-07-13T00:00:01.000Z",
      usage: {
        inputTokens: 50_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    };
    const call2 = {
      ...makeCall("m2"),
      timestamp: "2026-07-13T00:00:02.000Z",
      usage: {
        inputTokens: 30_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    };
    const call3 = {
      ...makeCall("m3"),
      timestamp: "2026-07-13T00:00:03.000Z",
      usage: {
        inputTokens: 50_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      },
    };
    const turn = makeTurn("p1", [call1, call2, call3]);
    // Reflect the aggregate (sum) — this is what the pre-fix code used.
    turn.usage = {
      inputTokens: call1.usage.inputTokens + call2.usage.inputTokens + call3.usage.inputTokens,
      outputTokens: call1.usage.outputTokens + call2.usage.outputTokens + call3.usage.outputTokens,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
    const session = deriveSession("s1", [call1, call2, call3], [turn], noSidecars);
    // Latest call (m3) own usage: 50k + 10k = 60k; default Sonnet 200k
    // window → 0.30. Pre-fix would have computed 140k / 200k = 0.70.
    expect(session.contextPctEstimated).toBeCloseTo(0.3, 6);
  });

  it("contextPctEstimated picks the latest call BY TIMESTAMP, not array position", () => {
    // Out-of-order input (warm-cache reconstruction or partial-tail state
    // can land calls out of order) — the resolver should still pick the
    // chronologically newest. Here m3 has the earliest timestamp but is at
    // index 2; m1 is at index 0 but has the latest timestamp. The fix
    // selects m1, not m3.
    const m1 = {
      ...makeCall("m1"),
      timestamp: "2026-07-13T00:00:10.000Z",
      usage: { inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    };
    const m2 = {
      ...makeCall("m2"),
      timestamp: "2026-07-13T00:00:05.000Z",
      usage: { inputTokens: 99_000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    };
    const m3 = {
      ...makeCall("m3"),
      timestamp: "2026-07-13T00:00:01.000Z",
      usage: { inputTokens: 99_000, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    };
    const turn = makeTurn("p1", [m1, m2, m3]);
    turn.usage = {
      inputTokens: m1.usage.inputTokens + m2.usage.inputTokens + m3.usage.inputTokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    };
    const session = deriveSession("s1", [m1, m2, m3], [turn], noSidecars);
    // m1 (10k) wins on timestamp; 10k / 200k = 0.05.
    // Pre-fix would have picked m3 (array index 2) at 99k / 200k = 0.495.
    expect(session.contextPctEstimated).toBeCloseTo(0.05, 6);
  });
});
