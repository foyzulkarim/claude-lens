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
import { projectSessionDetail } from "./projector.js";

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
const _noContextResolver = () => 200_000;

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

describe("projectSessionDetail — empty / minimal inputs", () => {
  it("returns 200-shape response with empty sections for a known session with no calls", () => {
    const snap = snapshotWith(sessionWithTier({ callCount: 0, costComputed: 0 }), [], [], []);

    const result = projectSessionDetail(snap, [], [], {});

    expect(result.header.logicalTurnCount).toBe(0);
    expect(result.timeline).toEqual([]);
    expect(result.turns).toEqual([]);
    expect(result.cache).toEqual([]);
    expect(result.toolMix).toEqual([]);
    expect(result.toolTimeline).toEqual([]);
    expect(result.prompts).toEqual([]);
    expect(result.workflow).toMatchObject({
      baseEditCount: 0,
      readFirstCount: 0,
      plannedCount: 0,
      verifiedCount: 0,
      committedCount: 0,
    });
    expect(result.tokenFunnel).toEqual({
      contextOffered: 0,
      cacheServed: 0,
      freshBilled: 0,
      output: 0,
    });
    expect(result.contextComposition).toEqual([]);
    expect(result.meta.isEmpty).toBe(true);
    expect(result.meta.costBasis).toBe("computed");
    expect(result.meta.fleetBaselineSize).toBe(0);
    expect(result.meta.availability).toEqual([]);
  });

  it("never returns NaN or Infinity in any number field for unpriced input", () => {
    const snap = snapshotWith(
      sessionWithTier(),
      [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })],
      [
        turn("p1", false, [
          call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) }),
        ]),
      ],
      [{ sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-14T09:59:00.000Z" }],
    );

    const result = projectSessionDetail(snap, [], [], {});

    // Walk every numeric leaf — must be finite or undefined, never NaN/Inf.
    const json = JSON.stringify(result);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("Infinity");
  });
});

describe("projectSessionDetail — header", () => {
  it("exposes identity, cost basis, fleet median, and rank", () => {
    const session = sessionWithTier({ costComputed: 10, callCount: 5, turnCount: 2 });
    const snap = snapshotWith(session, [], [], []);
    const fleetCosts = [2, 5, 8, 10, 20]; // this session ties with index 3

    const result = projectSessionDetail(snap, [], fleetCosts, { pricer: flatPricer });

    expect(result.header.sessionId).toBe("s1");
    expect(result.header.costComputed).toBe(10);
    expect(result.header.fleetCostMedian).toBe(8);
    // 3 values strictly less than 10 out of 5 → 60%.
    expect(result.header.fleetCostRankPct).toBe(60);
    expect(result.header.tier.costBasis).toBe("computed");
  });

  it("drift is absent when costObserved is undefined", () => {
    const session = sessionWithTier({ costComputed: 10 });
    const snap = snapshotWith(session, [], [], []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.header.drift).toBeUndefined();
    expect(result.meta.availability).not.toContain("header.drift");
  });

  it("drift is present with delta + pct when costObserved is supplied", () => {
    const session = sessionWithTier({ costComputed: 10, costObserved: 12 });
    const snap = snapshotWith(session, [], [], []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.header.drift).toEqual({ delta: 2, pct: 0.2 });
    expect(result.meta.availability).toContain("header.drift");
  });
});

describe("projectSessionDetail — observed turn fields (#P4-13)", () => {
  it("surfaces reconciled apiMs / lines / wallMs on turns and advertises availability", () => {
    const c1 = call("m1", "2026-07-14T10:00:00.000Z", { promptId: "p1" });
    const mainTurn = turn("p1", false, [c1], {
      apiMs: 4200,
      linesAdded: 7,
      linesRemoved: 3,
      wallMs: 9000,
    });
    const session = sessionWithTier({
      turnCount: 1,
      tier: {
        hasCostSamples: true,
        hasTurnBoundaries: true,
        hasCostLog: false,
        costBasis: "observed",
      },
    });
    const snap = snapshotWith(
      session,
      [c1],
      [mainTurn],
      [{ sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-14T10:00:00.000Z" }],
    );
    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    const row = result.turns[0];
    expect(row?.apiMs).toBe(4200);
    expect(row?.linesAdded).toBe(7);
    expect(row?.linesRemoved).toBe(3);
    expect(row?.wallMs).toBe(9000);
    expect(result.meta.availability).toContain("turn.apiMs");
    expect(result.meta.availability).toContain("turn.linesAdded");
  });

  it("leaves observed turn fields and availability absent for transcript-only turns", () => {
    const c1 = call("m1", "2026-07-14T10:00:00.000Z", { promptId: "p1" });
    const mainTurn = turn("p1", false, [c1]);
    const snap = snapshotWith(
      sessionWithTier({ turnCount: 1 }),
      [c1],
      [mainTurn],
      [{ sessionId: "s1", promptId: "p1", text: "hi", timestamp: "2026-07-14T10:00:00.000Z" }],
    );
    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    const row = result.turns[0];
    expect(row?.apiMs).toBeUndefined();
    expect(row?.linesAdded).toBeUndefined();
    expect(result.meta.availability).not.toContain("turn.apiMs");
    expect(result.meta.availability).not.toContain("turn.linesAdded");
  });

  it("exposes observed context % on the header when reconciled", () => {
    const session = sessionWithTier({ contextPctObserved: 0.42 });
    const snap = snapshotWith(session, [], [], []);
    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });
    expect(result.header.contextPctObserved).toBeCloseTo(0.42);
    expect(result.meta.availability).toContain("header.contextPct");
  });
});

describe("projectSessionDetail — timeline", () => {
  it("produces cumulative cost/tokens and marks logical turn boundaries", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) }),
      call("m2", "2026-07-14T10:01:00.000Z", { usage: usage({ inputTokens: 200 }) }),
      call("m3", "2026-07-14T10:02:00.000Z", { usage: usage({ inputTokens: 50 }) }),
    ];
    const turns = [turn("p1", false, [calls[0], calls[1]]), turn("p2", false, [calls[2]])];
    const snap = snapshotWith(sessionWithTier(), calls, turns, [
      { sessionId: "s1", promptId: "p1", text: "first", timestamp: "2026-07-14T09:59:00.000Z" },
      { sessionId: "s1", promptId: "p2", text: "second", timestamp: "2026-07-14T10:01:30.000Z" },
    ]);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.timeline).toHaveLength(3);
    expect(result.timeline[0]).toMatchObject({
      callIndex: 0,
      cumulativeCost: 0.1,
      cumulativeTokens: 100,
      cost: 0.1,
      turnNumber: 1,
      isTurnBoundary: true,
      isCompaction: false,
    });
    expect(result.timeline[1]).toMatchObject({
      callIndex: 1,
      cumulativeCost: 0.3,
      turnNumber: 1,
      isTurnBoundary: false,
    });
    expect(result.timeline[2]).toMatchObject({
      callIndex: 2,
      cumulativeCost: 0.35,
      turnNumber: 2,
      isTurnBoundary: true,
    });
  });

  it("flags compactions on the call at or after the marker timestamp", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z"),
      call("m2", "2026-07-14T10:02:00.000Z"),
      call("m3", "2026-07-14T10:04:00.000Z"),
    ];
    const turns = [
      turn("p1", false, [calls[0]]),
      turn("p2", false, [calls[1]]),
      turn("p3", false, [calls[2]]),
    ];
    const compactions: CompactionRecord[] = [
      { sessionId: "s1", timestamp: "2026-07-14T10:02:00.000Z" },
    ];
    const snap = snapshotWith(sessionWithTier(), calls, turns, [], [], compactions);

    const result = projectSessionDetail(snap, [], [], {});

    expect(result.timeline[0]?.isCompaction).toBe(false);
    expect(result.timeline[1]?.isCompaction).toBe(true);
    expect(result.timeline[2]?.isCompaction).toBe(true);
  });
});

describe("projectSessionDetail — cache strip causes", () => {
  it("first call → first-call; subsequent same-model → unexplained; model switch → model-switch", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", { model: "claude-sonnet-5" }),
      call("m2", "2026-07-14T10:01:00.000Z", { model: "claude-sonnet-5" }),
      call("m3", "2026-07-14T10:02:00.000Z", { model: "claude-fable-5" }),
      call("m4", "2026-07-14T10:03:00.000Z", { model: "claude-fable-5" }),
    ];
    const snap = snapshotWith(sessionWithTier(), calls, [turn("p1", false, calls)], []);

    const result = projectSessionDetail(snap, [], [], {});

    expect(result.cache.map((p) => p.cause)).toEqual([
      "first-call",
      "unexplained",
      "model-switch",
      "unexplained",
    ]);
  });

  it("compaction marker → compaction cause on the call at/after the marker", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", { model: "claude-sonnet-5" }),
      call("m2", "2026-07-14T10:02:00.000Z", { model: "claude-sonnet-5" }),
    ];
    const snap = snapshotWith(
      sessionWithTier(),
      calls,
      [turn("p1", false, calls)],
      [],
      [],
      [{ sessionId: "s1", timestamp: "2026-07-14T10:02:00.000Z" }],
    );

    const result = projectSessionDetail(snap, [], [], {});

    expect(result.cache[0]?.cause).toBe("first-call");
    expect(result.cache[1]?.cause).toBe("compaction");
  });
});

describe("projectSessionDetail — turns", () => {
  it("groups main + sidechain into one logical turn with combined cost/tokens/calls", () => {
    const mainCall = call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) });
    const sideCall = call("m2", "2026-07-14T10:00:05.000Z", {
      isSidechain: true,
      usage: usage({ inputTokens: 50 }),
    });
    const turns = [turn("p1", false, [mainCall]), turn("p1", true, [sideCall])];
    const snap = snapshotWith(sessionWithTier(), [mainCall, sideCall], turns, [
      { sessionId: "s1", promptId: "p1", text: "do thing", timestamp: "2026-07-14T09:59:00.000Z" },
    ]);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({
      turnNumber: 1,
      promptId: "p1",
      cost: 0.15, // 100 + 50, both priced
      mainCost: 0.1,
      sidechainCost: 0.05,
      tokens: 150,
      callCount: 2,
      hasSidechain: true,
      fleetPercentile: null, // empty fleet baseline
      isAnomaly: false,
    });
  });

  it("reports fleetPercentile + isAnomaly from the baseline", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) })];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);
    // Fleet turn costs all at 0.01; this session's 0.1 is strictly greater
    // than every fleet value, so percentile is 100% and the 5× median
    // threshold (0.05) is exceeded.
    const fleetTurnCosts = [0.01, 0.01, 0.01, 0.01, 0.01];

    const result = projectSessionDetail(snap, fleetTurnCosts, [], { pricer: flatPricer });

    expect(result.turns[0]?.fleetPercentile).toBe(100); // strictly-less=5 of 5
    expect(result.turns[0]?.isAnomaly).toBe(true); // 0.1 > 0.01 × 5
  });

  it("aggregates tools per logical turn (counts + bytes)", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", {
        tools: [
          { name: "Read", inputBytes: 100 },
          { name: "Read", inputBytes: 200 },
        ],
      }),
      call("m2", "2026-07-14T10:00:30.000Z", {
        tools: [{ name: "Edit", inputBytes: 150 }],
      }),
    ];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.turns[0]?.tools).toEqual([
      { name: "Read", count: 2, inputBytes: 300 },
      { name: "Edit", count: 1, inputBytes: 150 },
    ]);
  });
});

describe("projectSessionDetail — tool mix and context composition", () => {
  it("groups tool-result bytes by originating tool with Unknown fallback", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", {
        tools: [
          { id: "tu_read", name: "Read", inputBytes: 10 },
          { id: "tu_bash", name: "Bash", inputBytes: 5 },
        ],
      }),
      call("m2", "2026-07-14T10:00:30.000Z", {
        tools: [{ id: "tu_write", name: "Write", inputBytes: 8 }],
      }),
    ];
    const turns = [turn("p1", false, calls)];
    const toolResults: ToolResultBytesRecord[] = [
      // Read result
      { sessionId: "s1", promptId: "p1", toolUseId: "tu_read", bytes: 100, isError: false },
      // Bash result
      { sessionId: "s1", promptId: "p1", toolUseId: "tu_bash", bytes: 200, isError: false },
      // Write result
      { sessionId: "s1", promptId: "p1", toolUseId: "tu_write", bytes: 50, isError: false },
      // Unknown result (no matching toolUseId)
      { sessionId: "s1", promptId: "p1", toolUseId: "tu_missing", bytes: 30, isError: false },
    ];
    const snap = snapshotWith(sessionWithTier(), calls, turns, [], toolResults);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.toolMix).toEqual([
      // Sorted by callCount desc, then inputBytes desc. Read/Write/Bash
      // each have callCount=1, so they tie-break on inputBytes (Read=10,
      // Write=8, Bash=5). Unknown has callCount=0 so it sorts last.
      { name: "Read", callCount: 1, inputBytes: 10, resultBytes: 100, share: 100 / 380 },
      { name: "Write", callCount: 1, inputBytes: 8, resultBytes: 50, share: 50 / 380 },
      { name: "Bash", callCount: 1, inputBytes: 5, resultBytes: 200, share: 200 / 380 },
      { name: "Unknown", callCount: 0, inputBytes: 0, resultBytes: 30, share: 30 / 380 },
    ]);
    expect(result.contextComposition).toEqual([
      { toolName: "Bash", bytes: 200, share: 200 / 380 },
      { toolName: "Read", bytes: 100, share: 100 / 380 },
      { toolName: "Write", bytes: 50, share: 50 / 380 },
      { toolName: "Unknown", bytes: 30, share: 30 / 380 },
    ]);
  });

  it("never exposes target paths or shell commands in the wire response", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", {
        tools: [
          { id: "tu_read", name: "Read", inputBytes: 10, targetPath: "/secret/file.ts" },
          { id: "tu_bash", name: "Bash", inputBytes: 5, bashKind: "git-commit" },
        ],
      }),
    ];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    const json = JSON.stringify(result);
    expect(json).not.toContain("/secret/file.ts");
    // bashKind is fine to surface as a count bucket (toolMix), but the
    // command string itself is never retained. Verify nothing resembling a
    // command leaked into any wire field.
    expect(json).not.toContain("command");
  });
});

describe("projectSessionDetail — workflow funnel (cumulative monotonic)", () => {
  it("baseEditCount + readFirstCount + plannedCount + verifiedCount + committedCount with cumulative non-increasing invariant", () => {
    const editCall = (ts: string) =>
      call(ts, ts, { tools: [{ id: "tu", name: "Edit", inputBytes: 1 }] });
    const readCall = (ts: string) =>
      call(ts, ts, { tools: [{ id: "tu", name: "Read", inputBytes: 1 }] });
    const planCall = (ts: string) =>
      call(ts, ts, { tools: [{ id: "tu", name: "TodoWrite", inputBytes: 1 }] });
    const verifyCall = (ts: string) =>
      call(ts, ts, { tools: [{ id: "tu", name: "Bash", inputBytes: 1 }] });
    const commitCall = (ts: string) =>
      call(ts, ts, {
        tools: [{ id: "tu", name: "Bash", inputBytes: 1, bashKind: "git-commit" }],
      });

    const calls = [
      editCall("2026-07-14T10:00:00.000Z"), // turn 1: edit only
      editCall("2026-07-14T10:00:10.000Z"), // turn 2: edit only
      planCall("2026-07-14T10:00:20.000Z"), // turn 3: plan only (not in edit cohort)
      editCall("2026-07-14T10:00:30.000Z"), // turn 4: edit + (cumulative plan)
      readCall("2026-07-14T10:00:40.000Z"), // turn 5: read only
      editCall("2026-07-14T10:00:50.000Z"), // turn 6: edit (read + plan cum)
      verifyCall("2026-07-14T10:01:00.000Z"), // turn 7: verify only
      editCall("2026-07-14T10:01:10.000Z"), // turn 8: edit (cum verify too)
      commitCall("2026-07-14T10:01:20.000Z"), // turn 9: commit only
    ];
    // Synthesize one logical turn per call for deterministic grouping.
    const turns = calls.map((c, i) => turn(`p${i + 1}`, false, [c]));
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    // 5 edit turns: 1, 2, 4, 6, 8 (turn 5 is read-only, 3 is plan-only,
    // 7 is verify-only, 9 is commit-only — none of those are in the edit
    // cohort).
    expect(result.workflow.baseEditCount).toBe(5);
    // Cumulative monotonic non-increasing:
    // baseEditCount >= plannedCount >= verifiedCount >= committedCount
    expect(result.workflow.plannedCount).toBeLessThanOrEqual(result.workflow.baseEditCount);
    expect(result.workflow.verifiedCount).toBeLessThanOrEqual(result.workflow.plannedCount);
    expect(result.workflow.committedCount).toBeLessThanOrEqual(result.workflow.verifiedCount);
    expect(result.workflow.committedCount).toBeLessThanOrEqual(5);
    expect(result.workflow.stages.map((s) => s.id)).toEqual([
      "edit",
      "read",
      "plan",
      "verify",
      "commit",
    ]);
  });
});

describe("projectSessionDetail — token funnel reconciliation", () => {
  it("contextOffered == cacheServed + freshBilled, output separate", () => {
    const calls = [
      call("m1", "2026-07-14T10:00:00.000Z", {
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheCreateTokens: 30 },
      }),
      call("m2", "2026-07-14T10:01:00.000Z", {
        usage: { inputTokens: 200, outputTokens: 30, cacheReadTokens: 70, cacheCreateTokens: 0 },
      }),
    ];
    const turns = [turn("p1", false, calls)];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.tokenFunnel).toEqual({
      contextOffered: 450, // 100+50+30 + 200+70+0
      cacheServed: 120, // 50+70
      freshBilled: 330, // 100+30 + 200+0
      output: 50, // 20+30
    });
    expect(result.tokenFunnel.contextOffered).toBe(
      result.tokenFunnel.cacheServed + result.tokenFunnel.freshBilled,
    );
  });
});

describe("projectSessionDetail — distribution", () => {
  it("reports population size + percentiles + histogram from the fleet baseline", () => {
    const snap = snapshotWith(sessionWithTier(), [], [], []);
    const fleet = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    const result = projectSessionDetail(snap, fleet, [], {});

    expect(result.turnDistribution.populationSize).toBe(10);
    expect(result.turnDistribution.p50).toBe(50);
    expect(result.turnDistribution.p90).toBe(90); // ceiling-rank: ceil(0.9 * 10) = 9 → sorted[8]
    expect(result.turnDistribution.histogram).toHaveLength(10);
    expect(result.turnDistribution.basis).toBe("all-history");
  });

  it("handles empty fleet baseline with null percentiles and empty histogram", () => {
    const snap = snapshotWith(sessionWithTier(), [], [], []);

    const result = projectSessionDetail(snap, [], [], {});

    expect(result.turnDistribution.populationSize).toBe(0);
    expect(result.turnDistribution.p50).toBeNull();
    expect(result.turnDistribution.p90).toBeNull();
    expect(result.turnDistribution.p99).toBeNull();
    expect(result.turnDistribution.histogram).toEqual([]);
  });
});

describe("projectSessionDetail — prompts", () => {
  it("emits prompts in logical-turn order with text + timestamp", () => {
    const calls = [call("m1", "2026-07-14T10:00:00.000Z"), call("m2", "2026-07-14T10:01:00.000Z")];
    const turns = [
      turn("p1", false, [calls[0]], { promptText: "first" }),
      turn("p2", false, [calls[1]], { promptText: "second" }),
    ];
    const snap = snapshotWith(sessionWithTier(), calls, turns, []);

    const result = projectSessionDetail(snap, [], [], { pricer: flatPricer });

    expect(result.prompts).toEqual([
      { turnNumber: 1, promptId: "p1", timestamp: "2026-07-14T10:00:00.000Z", text: "first" },
      { turnNumber: 2, promptId: "p2", timestamp: "2026-07-14T10:01:00.000Z", text: "second" },
    ]);
  });
});
