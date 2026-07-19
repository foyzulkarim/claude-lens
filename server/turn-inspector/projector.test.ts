import { describe, expect, it } from "vitest";
import type {
  ApiCall,
  CompactionRecord,
  Session,
  TierFlags,
  TokenUsage,
  Turn,
} from "../../shared/types.js";
import type { PromptTextRecord, ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import type { SessionSnapshot } from "../store/store.js";
import { projectTurnInspector } from "./projector.js";

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    ...overrides,
  };
}

function call(messageId: string, timestamp: string, overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `uuid-${messageId}`,
    sessionId: "s1",
    messageId,
    timestamp,
    model: "claude-sonnet-5",
    usage: usage(),
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(
  promptId: string,
  isSidechain: boolean,
  calls: ApiCall[],
  overrides: Partial<Turn> = {},
): Turn {
  const startedAt = calls[0]?.timestamp ?? "";
  const endedAt = calls[calls.length - 1]?.timestamp ?? startedAt;
  return {
    promptId,
    sessionId: "s1",
    isSidechain,
    startedAt,
    endedAt,
    calls,
    usage: usage(),
    toolResultBytes: 0,
    ...overrides,
  };
}

const flatPricer = (u: TokenUsage) => u.inputTokens * 0.001;

function sessionWithTier(overrides: Partial<Session> = {}): Session {
  const tier: TierFlags = {
    hasCostSamples: false,
    hasTurnBoundaries: false,
    hasCostLog: false,
    costBasis: "computed",
  };
  return {
    sessionId: "s1",
    lineageId: "s1",
    project: "/Users/demo/.claude",
    entrypoint: "cli",
    models: ["claude-sonnet-5"],
    gitBranch: "main",
    version: "1.0.0",
    host: "default",
    tier,
    firstAt: "2026-07-14T10:00:00.000Z",
    lastAt: "2026-07-14T10:05:00.000Z",
    usage: usage({ inputTokens: 100 }),
    turnCount: 0,
    callCount: 1,
    costComputed: 0,
    cacheHitPct: 0,
    ...overrides,
  };
}

function snapshotWith(
  session: Session,
  calls: ApiCall[],
  turns: Turn[],
  prompts: PromptTextRecord[],
  toolResults: ToolResultBytesRecord[] = [],
  compactions: CompactionRecord[] = [],
): SessionSnapshot {
  return {
    session,
    calls,
    turns,
    prompts,
    toolResults,
    compactions,
  };
}

describe("projectTurnInspector — null when the turn doesn't exist", () => {
  it("returns null for a turnNumber not present in the snapshot", () => {
    const snap = snapshotWith(sessionWithTier(), [], [], []);
    const result = projectTurnInspector(snap, 99, [], {});
    expect(result).toBeNull();
  });

  it("returns null for an empty session", () => {
    const snap = snapshotWith(sessionWithTier({ callCount: 0, turnCount: 0 }), [], [], []);
    const result = projectTurnInspector(snap, 1, [], {});
    expect(result).toBeNull();
  });
});

describe("projectTurnInspector — summary", () => {
  it("returns null fleetPercentile when the fleet baseline is empty", () => {
    // Contract: percentile is null when there are no fleet entries — the
    // 0/0 case `percentileRank` itself defends against.
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, [
      { sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-14T09:59:00.000Z" },
    ]);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result).not.toBeNull();
    expect(result?.summary.fleetPercentile).toBeNull();
    expect(result?.summary.isAnomaly).toBe(false);
    expect(result?.meta.fleetBaselineSize).toBe(0);
  });

  it("returns null fleetPercentile for a single-entry fleet baseline", () => {
    // Contract guard for #P2 of the review: a one-entry baseline has no
    // rank among itself; the prior implementation returned 0 (a strictly-
    // less floor-rank over a 1-element array), which would silently render
    // as "p0 of your turns" in the UI.
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, [
      { sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-14T09:59:00.000Z" },
    ]);

    const result = projectTurnInspector(snap, 1, [0.05], { pricer: flatPricer });

    expect(result?.summary.fleetPercentile).toBeNull();
    expect(result?.meta.fleetBaselineSize).toBe(1);
  });

  it("computes fleetPercentile + isAnomaly for a multi-entry baseline", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, [
      { sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-14T09:59:00.000Z" },
    ]);
    // Five entries at 0.01 — this turn's 0.1 is strictly greater than every
    // fleet value, so percentile is 100% and 5× median (0.05) is exceeded.
    const fleet = [0.01, 0.01, 0.01, 0.01, 0.01];

    const result = projectTurnInspector(snap, 1, fleet, { pricer: flatPricer });

    expect(result?.summary.fleetPercentile).toBe(100);
    expect(result?.summary.isAnomaly).toBe(true);
  });

  it("omits wallMs/apiMs when the source Turn record lacks them", () => {
    // The wire contract says these premium fields are absent (never
    // fabricated) when the Store hasn't populated them — until #P4-13
    // ships, today always.
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    expect(result?.summary.wallMs).toBeUndefined();
    expect(result?.summary.apiMs).toBeUndefined();
    expect(result?.meta.availability).toEqual([]);
  });

  it("threads wallMs/apiMs through from the source Turn when present", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls, { wallMs: 12_000, gateStatus: "verified" as const })];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    expect(result?.summary.wallMs).toBe(12_000);
    expect(result?.summary.apiMs).toBeUndefined();
    expect(result?.meta.availability).toContain("summary.wallMs");
  });

  it("aggregates cost and tokens across main + sidechain calls", () => {
    const mainCall = call("m1", "2026-07-14T10:00:00.000Z", {
      usage: usage({ inputTokens: 100 }),
    });
    const sideCall = call("m2", "2026-07-14T10:00:05.000Z", {
      isSidechain: true,
      usage: usage({ inputTokens: 50 }),
    });
    const turns = [turn("p1", false, [mainCall]), turn("p1", true, [sideCall])];
    const snap = snapshotWith(sessionWithTier(), [mainCall, sideCall], turns, [
      { sessionId: "s1", promptId: "p1", text: "do thing", timestamp: "2026-07-14T09:59:00.000Z" },
    ]);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result?.summary.cost).toBe(0.15);
    expect(result?.summary.tokens).toBe(150);
    expect(result?.summary.callCount).toBe(2);
    expect(result?.summary.models).toContain("claude-sonnet-5");
  });
});

describe("projectTurnInspector — waterfall", () => {
  it("returns empty calls when the turn has no calls", () => {
    const turns = [turn("p1", false, [])];
    const snap = snapshotWith(sessionWithTier(), [], turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    expect(result?.waterfall.calls).toEqual([]);
  });

  it("interleaves main + sidechain calls chronologically and stamps offsetMs from the first call", () => {
    const main1 = call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) });
    const side1 = call("m2", "2026-07-14T10:00:10.000Z", {
      isSidechain: true,
      usage: usage({ inputTokens: 50 }),
    });
    const main2 = call("m3", "2026-07-14T10:00:30.000Z", { usage: usage({ inputTokens: 200 }) });
    const turns = [turn("p1", false, [main1, main2]), turn("p1", true, [side1])];
    const snap = snapshotWith(sessionWithTier(), [main1, side1, main2], turns, []);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result?.waterfall.calls.map((c) => c.messageId)).toEqual(["m1", "m2", "m3"]);
    expect(result?.waterfall.calls[0]?.offsetMs).toBe(0);
    expect(result?.waterfall.calls[1]?.offsetMs).toBe(10_000);
    expect(result?.waterfall.calls[2]?.offsetMs).toBe(30_000);
    expect(result?.waterfall.calls[1]?.isSidechain).toBe(true);
  });

  it("clamps a negative offsetMs to 0 (timestamp before the first call's ms anchor)", () => {
    // Synthetic edge case: a call with a clock-skewed timestamp earlier
    // than the turn's first call. The waterfall treats anything < 0 as 0
    // so a backward-going bar never renders with a negative width.
    const a = call("m1", "2026-07-14T10:00:30.000Z");
    const b = call("m2", "2026-07-14T10:00:00.000Z");
    const turns = [turn("p1", false, [a, b])];
    const snap = snapshotWith(sessionWithTier(), [a, b], turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    // orderedTurnCalls sorts ascending, so the earlier-timestamped call
    // (b) is the anchor with offsetMs=0; the later one (a) gets +30000.
    // Crucially, neither entry produces a negative offsetMs.
    const offsets = result?.waterfall.calls.map((c) => c.offsetMs) ?? [];
    expect(offsets).toHaveLength(2);
    expect(Math.min(...offsets)).toBe(0);
  });
});

describe("projectTurnInspector — cache narrative", () => {
  it("returns an empty array when the turn has no calls", () => {
    const turns = [turn("p1", false, [])];
    const snap = snapshotWith(sessionWithTier(), [], turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    expect(result?.cacheNarrative).toEqual([]);
  });

  it("attaches a narrative to write-spike cache points", () => {
    // Two calls so the first isn't classified as "first-call" (which
    // intentionally suppresses the narrative — there's nothing to write
    // about on the very first cache observation of a session).
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", {
        usage: usage({ inputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 }),
      }),
      call("m2", "2026-07-14T10:00:10.000Z", {
        usage: usage({ inputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 28_600 }),
      }),
    ];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    expect(result?.cacheNarrative).toHaveLength(2);
    expect(result?.cacheNarrative[1]?.isWriteSpike).toBe(true);
    expect(result?.cacheNarrative[1]?.narrative).toContain("28.6k tokens re-written");
  });

  it("attaches a narrative to unexplained drops", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", {
        usage: usage({ inputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 }),
      }),
      call("m2", "2026-07-14T10:00:10.000Z", {
        model: "claude-fable-5",
        usage: usage({ inputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 }),
      }),
      call("m3", "2026-07-14T10:00:20.000Z", {
        // Same model as m2, but a cache hit dropped — the "unexplained"
        // branch only fires when no model switch / compaction explains it.
        model: "claude-fable-5",
        usage: usage({ inputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 }),
      }),
    ];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectTurnInspector(snap, 1, [], {});

    const causes = result?.cacheNarrative.map((p) => p.cause) ?? [];
    expect(causes).toContain("model-switch");
    // The third point has same-model + same-no-compaction context, so it
    // should hit the unexplained branch.
    expect(causes[2]).toBe("unexplained");
  });
});

describe("projectTurnInspector — sidechain breakdown", () => {
  it("returns zero main + zero sidechains for a sidechain-free turn", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result?.sidechainBreakdown.mainCost).toBe(0.1);
    expect(result?.sidechainBreakdown.mainCallCount).toBe(1);
    expect(result?.sidechainBreakdown.sidechains).toEqual([]);
  });

  it("reports each sidechain's primary model and cost", () => {
    const mainCall = call("m1", "2026-07-14T10:00:00.000Z", {
      usage: usage({ inputTokens: 100 }),
    });
    const sideCall1 = call("m2", "2026-07-14T10:00:05.000Z", {
      isSidechain: true,
      agentId: "agent-1",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens: 25 }),
    });
    const sideCall2 = call("m3", "2026-07-14T10:00:07.000Z", {
      isSidechain: true,
      agentId: "agent-1",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens: 25 }),
    });
    const turns = [turn("p1", false, [mainCall]), turn("p1", true, [sideCall1, sideCall2])];
    const snap = snapshotWith(sessionWithTier(), [mainCall, sideCall1, sideCall2], turns, []);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result?.sidechainBreakdown.sidechains).toHaveLength(1);
    const side = result?.sidechainBreakdown.sidechains[0];
    expect(side?.callCount).toBe(2);
    expect(side?.cost).toBe(0.05);
    expect(side?.tokens).toBe(50);
    expect(side?.primaryModel).toBe("claude-haiku-4-5");
    expect(side?.agentId).toBe("agent-1");
  });

  it("handles a sidechain-only turn (no main segment)", () => {
    // Sidechain-only logical turns leave main undefined; the sidechain
    // breakdown must still produce a main row (zero-cost, zero-call) and
    // keep the sidechain group, otherwise the inspector renders blank.
    const sideCall = call("m1", "2026-07-14T10:00:05.000Z", {
      isSidechain: true,
      agentId: "agent-1",
      usage: usage({ inputTokens: 50 }),
    });
    const turns = [turn("p1", true, [sideCall])];
    const snap = snapshotWith(sessionWithTier(), [sideCall], turns, []);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result?.sidechainBreakdown.mainCost).toBe(0);
    expect(result?.sidechainBreakdown.mainCallCount).toBe(0);
    expect(result?.sidechainBreakdown.sidechains).toHaveLength(1);
  });
});

describe("projectTurnInspector — nav", () => {
  it("returns null prev/next at the boundaries", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectTurnInspector(snap, 1, [], { pricer: flatPricer });

    expect(result?.nav.prevTurnNumber).toBeNull();
    expect(result?.nav.nextTurnNumber).toBeNull();
    expect(result?.nav.totalTurns).toBe(1);
  });

  it("returns the neighboring turn numbers for a middle turn", () => {
    const mk = (id: string) =>
      call(id, "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) });
    const turns = [
      turn("p1", false, [mk("m1")]),
      turn("p2", false, [mk("m2")]),
      turn("p3", false, [mk("m3")]),
    ];
    const snap = snapshotWith(
      sessionWithTier(),
      turns.flatMap((t) => t.calls),
      turns,
      [],
    );

    const result = projectTurnInspector(snap, 2, [], { pricer: flatPricer });

    expect(result?.nav.prevTurnNumber).toBe(1);
    expect(result?.nav.nextTurnNumber).toBe(3);
    expect(result?.nav.totalTurns).toBe(3);
    expect(result?.summary.totalTurns).toBe(3);
  });
});

describe("projectTurnInspector — meta", () => {
  it("mirrors the session's costBasis and exposes fleetBaselineSize", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const session = sessionWithTier({
      tier: {
        hasCostSamples: true,
        hasTurnBoundaries: true,
        hasCostLog: true,
        costBasis: "observed",
      },
    });
    const snap = snapshotWith(session, calls, turns, []);

    const result = projectTurnInspector(snap, 1, [0.05, 0.1, 0.2], { pricer: flatPricer });

    expect(result?.meta.costBasis).toBe("observed");
    expect(result?.meta.fleetBaselineSize).toBe(3);
    expect(result?.meta.availability).toEqual([]);
  });
});
