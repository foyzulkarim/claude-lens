import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import {
  attributeCacheMiss,
  classifyCacheWrite,
  MAIN_STREAM_KEY,
  partitionCacheStreams,
} from "../cache/classifier.js";
import { computeScorecard } from "./engine.js";

function call(
  messageId: string,
  timestamp: string,
  usage: Partial<ApiCall["usage"]>,
  overrides: Partial<ApiCall> = {},
): ApiCall {
  return {
    uuid: `uuid-${messageId}`,
    sessionId: "scorecard-session",
    messageId,
    promptId: "prompt-1",
    timestamp,
    model: "claude-sonnet-5",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      ...usage,
    },
    isSidechain: false,
    tools: [],
    cwd: "/synthetic/project",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(promptId: string, calls: ApiCall[]): Turn {
  return {
    promptId,
    sessionId: "scorecard-session",
    isSidechain: false,
    startedAt: calls[0]?.timestamp ?? "2026-07-01T00:00:00.000Z",
    endedAt: calls.at(-1)?.timestamp ?? "2026-07-01T00:00:00.000Z",
    calls,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
  };
}

describe("computeScorecard", () => {
  it("matches a hand-calculated warmup, incremental growth, and prefix bust", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 100,
        cacheCreateTokens: 50,
      }),
      call("m3", "2026-07-01T00:02:00.000Z", {
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      }),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.decomposition).toEqual({ warmup: 100, incremental: 50, rewritten: 120 });
    expect(
      core.decomposition.warmup + core.decomposition.incremental + core.decomposition.rewritten,
    ).toBe(270);
    expect(
      core.writes.reduce(
        (sum, entry) => sum + entry.warmupTokens + entry.incrementalTokens + entry.rewrittenTokens,
        0,
      ),
    ).toBe(270);
  });

  it("lets a read-only call raise the epoch high-water mark", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", { cacheReadTokens: 300 }),
      call("m3", "2026-07-01T00:02:00.000Z", {
        cacheReadTokens: 300,
        cacheCreateTokens: 50,
      }),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.decomposition).toEqual({ warmup: 100, incremental: 50, rewritten: 0 });
    expect(core.writes.at(-1)).toMatchObject({ incrementalTokens: 50, rewrittenTokens: 0 });
  });

  it("stores one ledger entry per positive write and marks only rewritten entries as events", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("read-only", "2026-07-01T00:00:30.000Z", { cacheReadTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 100,
        cacheCreateTokens: 50,
      }),
      call("m3", "2026-07-01T00:02:00.000Z", {
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      }),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.writes).toHaveLength(3);
    expect(core.writes.map((entry) => entry.kind)).toEqual([null, null, "prefix-bust"]);
    expect(
      core.writes
        .filter((entry) => entry.rewrittenTokens > 0)
        .map((entry) => ({ kind: entry.kind, tokensRewritten: entry.rewrittenTokens })),
    ).toEqual([{ kind: "prefix-bust", tokensRewritten: 120 }]);
  });

  it("uses zero hit ratio but null waste and hygiene ratios on empty denominators", () => {
    const zeroCall = call("zero", "2026-07-01T00:00:00.000Z", {});

    const core = computeScorecard([zeroCall], [turn("prompt-1", [zeroCall])]);

    expect(core.hitRatio).toBe(0);
    expect(core.wasteRatio).toBeNull();
    expect(core.hygieneScore).toBeNull();
  });

  it("copies the canonical base cause and attribution verbatim onto rewritten entries", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 100,
        cacheCreateTokens: 50,
      }),
      call("m3", "2026-07-01T00:02:00.000Z", {
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      }),
    ];
    const stream = partitionCacheStreams(calls).get(`scorecard-session::${MAIN_STREAM_KEY}`) ?? [];
    const canonical = classifyCacheWrite(stream, 2, { threshold: 0 });
    const current = calls[2];
    expect(canonical).not.toBeNull();
    expect(current).toBeDefined();

    const event = computeScorecard(calls, [turn("prompt-1", calls)]).writes.at(-1);

    expect(event).toMatchObject({
      baseCause: canonical?.baseCause,
      attribution:
        canonical && current ? attributeCacheMiss(canonical, current, calls[1]) : undefined,
    });
    expect(event?.baseCause).toBe("unexplained");
  });

  it("uses threshold zero without changing verdicts for writes above the K2 alert threshold", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 20_000 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 20_000,
        cacheCreateTokens: 1,
      }),
      call("m3", "2026-07-01T00:02:00.000Z", { cacheCreateTokens: 20_001 }),
    ];
    const stream = partitionCacheStreams(calls).get(`scorecard-session::${MAIN_STREAM_KEY}`) ?? [];

    expect(classifyCacheWrite(stream, 2, { threshold: 0 })?.baseCause).toBe(
      classifyCacheWrite(stream, 2)?.baseCause,
    );
  });

  it("keeps ttl-lapse and unknown waste grade-neutral while prefix busts lower hygiene", () => {
    const firstWrites = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 100,
        cacheCreateTokens: 50,
      }),
    ];
    const baseline = computeScorecard(firstWrites, [turn("prompt-1", firstWrites)]);
    const ttlCalls = [
      ...firstWrites,
      call("ttl", "2026-07-01T00:10:00.000Z", {
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      }),
    ];
    const unknownCalls = [
      ...firstWrites,
      call("unknown", "2026-07-01T00:02:00.000Z", { cacheCreateTokens: 120 }),
    ];
    const bustCalls = [
      ...firstWrites,
      call("bust", "2026-07-01T00:02:00.000Z", {
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      }),
    ];

    expect(baseline.hygieneScore).toBe(1);
    expect(computeScorecard(ttlCalls, [turn("prompt-1", ttlCalls)]).hygieneScore).toBe(1);
    expect(computeScorecard(unknownCalls, [turn("prompt-1", unknownCalls)]).hygieneScore).toBe(1);
    expect(computeScorecard(bustCalls, [turn("prompt-1", bustCalls)]).hygieneScore).toBeLessThan(1);
  });

  it("keeps score inputs auditable from the decomposition", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 100,
        cacheCreateTokens: 50,
      }),
      call("m3", "2026-07-01T00:02:00.000Z", {
        cacheCreateTokens: 120,
        cacheCreate5m: 120,
      }),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.scoreInputs).toEqual({ confirmedFixableWaste: 120, scoreableCreation: 270 });
    expect(core.scoreInputs.scoreableCreation).toBe(
      core.decomposition.warmup +
        core.decomposition.incremental +
        core.scoreInputs.confirmedFixableWaste,
    );
    expect(core.hygieneScore).toBe(
      1 - core.scoreInputs.confirmedFixableWaste / core.scoreInputs.scoreableCreation,
    );
  });

  it("counts a repeated same-prompt/model warmup rewrite as duplicated warmup", () => {
    const calls = [
      call("a-warmup", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("b-warmup", "2026-07-01T00:01:00.000Z", { cacheCreateTokens: 80 }, { model: "model-b" }),
      call("switch-back", "2026-07-01T00:02:00.000Z", {}, { model: "claude-sonnet-5" }),
      call("establish", "2026-07-01T00:03:00.000Z", { cacheReadTokens: 100 }),
      call("duplicate", "2026-07-01T00:04:00.000Z", { cacheCreateTokens: 100 }),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.writes.at(-1)).toMatchObject({
      rewrittenTokens: 100,
      kind: "duplicated-warmup",
    });
    expect(core.scoreInputs.confirmedFixableWaste).toBe(100);
  });

  it("joins writes to one-based logical turns and keeps missing-turn writes", () => {
    const linked = call("linked", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 });
    const missing = call(
      "missing",
      "2026-07-01T00:01:00.000Z",
      { cacheReadTokens: 100, cacheCreateTokens: 10 },
      { promptId: "prompt-without-turn" },
    );

    const core = computeScorecard([linked, missing], [turn("prompt-1", [linked])]);

    expect(core.writes.map((entry) => [entry.callId, entry.turnNumber])).toEqual([
      ["linked", 1],
      ["missing", null],
    ]);
  });

  it("starts new warmup epochs for first-call, model-switch, and compaction writes", () => {
    const calls = [
      call("first", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call(
        "model-switch",
        "2026-07-01T00:01:00.000Z",
        { cacheCreateTokens: 200 },
        { model: "model-b" },
      ),
      call(
        "before-drop",
        "2026-07-01T00:02:00.000Z",
        { cacheReadTokens: 200 },
        { model: "model-b" },
      ),
      call("after-drop", "2026-07-01T00:03:00.000Z", { cacheReadTokens: 50 }, { model: "model-b" }),
      call(
        "compaction",
        "2026-07-01T00:04:00.000Z",
        { cacheCreateTokens: 150 },
        { model: "model-b" },
      ),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.writes.map((entry) => entry.baseCause)).toEqual([
      "first-call",
      "model-switch",
      "compaction",
    ]);
    expect(core.writes.map((entry) => entry.kind)).toEqual([null, null, null]);
    expect(core.decomposition).toEqual({ warmup: 450, incremental: 0, rewritten: 0 });
  });

  it("resets established context on a zero-create model switch without adding warmup", () => {
    const calls = [
      call("warmup", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("switch", "2026-07-01T00:01:00.000Z", {}, { model: "model-b" }),
      call("growth", "2026-07-01T00:02:00.000Z", { cacheCreateTokens: 50 }, { model: "model-b" }),
    ];

    const core = computeScorecard(calls, [turn("prompt-1", calls)]);

    expect(core.decomposition).toEqual({ warmup: 100, incremental: 50, rewritten: 0 });
    expect(core.writes.at(-1)).toMatchObject({ warmupTokens: 0, incrementalTokens: 50 });
  });

  it("excludes sidechain calls even when a missing agentId puts them in the main bucket", () => {
    const main = call("main", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 });
    const unkeyedSidechain = call(
      "sidechain",
      "2026-07-01T00:01:00.000Z",
      { cacheCreateTokens: 50_000 },
      { isSidechain: true, agentId: undefined },
    );

    const core = computeScorecard([main, unkeyedSidechain], [turn("prompt-1", [main])]);

    expect(core.mainThreadCalls).toBe(1);
    expect(core.decomposition).toEqual({ warmup: 100, incremental: 0, rewritten: 0 });
    expect(core.writes.map((entry) => entry.callId)).toEqual(["main"]);
  });

  it("is byte-deterministic for identical inputs", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 100 }),
      call("m2", "2026-07-01T00:01:00.000Z", {
        cacheReadTokens: 100,
        cacheCreateTokens: 50,
      }),
    ];
    const turns = [turn("prompt-1", calls)];

    expect(JSON.stringify(computeScorecard(calls, turns))).toBe(
      JSON.stringify(computeScorecard(calls, turns)),
    );
  });

  it("orders same-timestamp ledger entries by stable call identity", () => {
    const sameTimestamp = "2026-07-01T00:00:00.000Z";
    const calls = [
      call("b", sameTimestamp, { cacheCreateTokens: 100 }),
      call("a", sameTimestamp, { cacheCreateTokens: 50 }),
    ];

    expect(
      computeScorecard(calls, [turn("prompt-1", calls)]).writes.map((entry) => entry.callId),
    ).toEqual(["a", "b"]);
  });

  it("returns valid cores without throwing for empty, single-call, and all-read sessions", () => {
    const single = call("single", "2026-07-01T00:00:00.000Z", { cacheCreateTokens: 1 });
    const read = call("read", "2026-07-01T00:00:00.000Z", { cacheReadTokens: 100 });

    expect(computeScorecard([], [])).toMatchObject({ mainThreadCalls: 0, writes: [] });
    expect(computeScorecard([single], [turn("prompt-1", [single])]).writes).toHaveLength(1);
    expect(computeScorecard([read], [turn("prompt-1", [read])])).toMatchObject({
      cacheReadTokens: 100,
      writes: [],
      hygieneScore: null,
    });
  });
});
