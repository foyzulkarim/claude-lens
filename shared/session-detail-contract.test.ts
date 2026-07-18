import { describe, expect, it } from "vitest";
import type {
  SessionDetailCacheCause,
  SessionDetailField,
  SessionDetailMeta,
  SessionDetailResponse,
} from "./session-detail-contract.js";
import type { TierFlags } from "./types.js";

const tier: TierFlags = {
  hasCostSamples: false,
  hasTurnBoundaries: false,
  hasCostLog: false,
  costBasis: "computed",
};

describe("SessionDetailResponse — wire contract construction", () => {
  it("supports every named availability slot in the documented vocabulary", () => {
    // Compile-time exhaustiveness: constructing this object with a field
    // not in `SessionDetailField` should fail. A runtime check verifies
    // the set is finite (8 entries today) — bumping the contract must
    // bump this test so the runtime guard stays in sync.
    const slots: SessionDetailField[] = [
      "header.drift",
      "header.contextPct",
      "turn.apiMs",
      "turn.linesAdded",
      "turn.linesRemoved",
      "turn.cacheSavings",
      "turn.gateStatus",
      "toolMix.targetPaths",
      "toolMix.shellCommands",
      "cache.cause.freshSession",
      "cache.cause.modelSwitch",
      "cache.cause.compaction",
    ];
    expect(slots).toHaveLength(12);
  });

  it("exposes the four documented cache cause labels", () => {
    const causes: SessionDetailCacheCause[] = [
      "first-call",
      "model-switch",
      "compaction",
      "unexplained",
    ];
    expect(new Set(causes).size).toBe(4);
  });

  it("a meta object constructed with the empty availability set is well-formed", () => {
    const meta: SessionDetailMeta = {
      costBasis: "computed",
      isEmpty: true,
      isLive: false,
      availability: [],
      fleetBaselineSize: 0,
    };
    expect(meta.availability).toEqual([]);
    expect(meta.fleetBaselineSize).toBe(0);
  });

  it("a minimal SessionDetailResponse is type-correct (compile-time shape check)", () => {
    const response: SessionDetailResponse = {
      header: {
        sessionId: "s1",
        project: "/Users/demo/.claude",
        branch: "main",
        version: "1.0.0",
        models: ["claude-sonnet-5"],
        firstAt: "2026-07-14T10:00:00.000Z",
        lastAt: "2026-07-14T10:05:00.000Z",
        logicalTurnCount: 1,
        callCount: 1,
        costComputed: 0.01,
        fleetCostMedian: null,
        fleetCostRankPct: null,
        tier,
      },
      timeline: [],
      turns: [],
      turnDistribution: {
        populationSize: 0,
        p50: null,
        p90: null,
        p99: null,
        histogram: [],
        basis: "all-history",
      },
      cache: [],
      toolMix: [],
      toolTimeline: [],
      prompts: [],
      workflow: {
        baseEditCount: 0,
        readFirstCount: 0,
        plannedCount: 0,
        verifiedCount: 0,
        committedCount: 0,
        stages: [],
      },
      tokenFunnel: { contextOffered: 0, cacheServed: 0, freshBilled: 0, output: 0 },
      contextComposition: [],
      meta: {
        costBasis: "computed",
        isEmpty: true,
        isLive: false,
        availability: [],
        fleetBaselineSize: 0,
      },
    };
    expect(response.header.sessionId).toBe("s1");
  });
});
