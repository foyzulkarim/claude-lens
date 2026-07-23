import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import type { CostLogRow, CostSample } from "../ingest/parse-premium.js";
import { reconcilePremium } from "./reconcile-premium.js";

function call(timestamp: string, overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${timestamp}`,
    sessionId: "s1",
    messageId: `m-${timestamp}`,
    timestamp,
    model: "claude-sonnet-5",
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    isSidechain: false,
    tools: [],
    cwd: "/x",
    gitBranch: "main",
    version: "1",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(promptId: string, calls: ApiCall[], overrides: Partial<Turn> = {}): Turn {
  const startedAt = calls[0]?.timestamp ?? "";
  const endedAt = calls[calls.length - 1]?.timestamp ?? "";
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    startedAt,
    endedAt,
    calls,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
    ...overrides,
  };
}

function sample(timestamp: string, overrides: Partial<CostSample> = {}): CostSample {
  return {
    sessionId: "s1",
    timestamp,
    costDeltaUsd: 0.1,
    cumulativeCostUsd: 0,
    apiDurationMs: 1000,
    contextPct: 10,
    linesAdded: 2,
    linesRemoved: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

const noPremium = { costSamples: [], turnBoundaries: [] };

describe("reconcilePremium", () => {
  it("returns inputs untouched with no premium content", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("p1", c)];
    const result = reconcilePremium(c, t, noPremium);
    expect(result.calls).toBe(c); // same reference, no copy
    expect(result.turns).toBe(t);
    expect(result.session).toEqual({});
  });

  it("attributes each C sample to the last call at-or-before its timestamp", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:05.000Z");
    const c = [c1, c2];
    const t = [turn("p1", c)];
    // one sample after c1 (before c2), one after c2
    const samples = [
      sample("2026-07-03T00:00:02.000Z", { costDeltaUsd: 0.1, apiDurationMs: 1500, contextPct: 8 }),
      sample("2026-07-03T00:00:06.000Z", {
        costDeltaUsd: 0.3,
        apiDurationMs: 2500,
        contextPct: 20,
      }),
    ];
    const result = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] });

    const [a1, a2] = result.calls;
    expect(a1?.costObserved).toBeCloseTo(0.1);
    expect(a1?.apiMs).toBe(1500);
    expect(a1?.contextPct).toBe(8);
    expect(a2?.costObserved).toBeCloseTo(0.3);
    expect(a2?.apiMs).toBe(2500);
    expect(a2?.contextPct).toBe(20);
  });

  it("takes MAX apiMs and LAST context_pct per call across multiple samples", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c = [c1];
    const t = [turn("p1", c)];
    const samples = [
      sample("2026-07-03T00:00:02.000Z", { apiDurationMs: 1000, contextPct: 5, costDeltaUsd: 0.1 }),
      sample("2026-07-03T00:00:03.000Z", { apiDurationMs: 3000, contextPct: 9, costDeltaUsd: 0.2 }),
      sample("2026-07-03T00:00:04.000Z", { apiDurationMs: 2000, contextPct: 7, costDeltaUsd: 0.3 }),
    ];
    const a1 = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).calls[0];
    expect(a1?.apiMs).toBe(3000); // MAX
    expect(a1?.contextPct).toBe(7); // LAST (latest timestamp)
    expect(a1?.costObserved).toBeCloseTo(0.6); // SUM
    expect(a1?.linesAdded).toBe(6); // 2*3 SUM
  });

  it("rolls turn apiMs/lines as the SUM across the turn's calls", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:05.000Z");
    const c = [c1, c2];
    const t = [turn("p1", c)];
    const samples = [
      sample("2026-07-03T00:00:02.000Z", { apiDurationMs: 1500, linesAdded: 2, linesRemoved: 1 }),
      sample("2026-07-03T00:00:06.000Z", { apiDurationMs: 2500, linesAdded: 4, linesRemoved: 3 }),
    ];
    const rt = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).turns[0];
    expect(rt?.apiMs).toBe(4000); // 1500 + 2500
    expect(rt?.linesAdded).toBe(6);
    expect(rt?.linesRemoved).toBe(4);
  });

  it("computes the session rollup as SUM cost/lines and LAST context%", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("p1", c)];
    const samples = [
      sample("2026-07-03T00:00:02.000Z", { costDeltaUsd: 0.1, contextPct: 8 }),
      sample("2026-07-03T00:00:03.000Z", { costDeltaUsd: 0.25, contextPct: 42 }),
    ];
    const s = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.costObserved).toBeCloseTo(0.35);
    expect(s.contextPctObserved).toBeCloseTo(0.42); // 42/100
    expect(s.linesAdded).toBe(4);
  });

  it("derives observed wallMs from a B boundary (turn_end − startedAt)", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:05.000Z");
    const t = [turn("p1", [c1, c2])];
    const boundaries = [
      {
        sessionId: "s1",
        transcriptPath: "/x/s1.jsonl",
        turnEnd: "2026-07-03T00:00:11.000Z",
        turnEndEpoch: 0,
      },
    ];
    const rt = reconcilePremium([c1, c2], t, { costSamples: [], turnBoundaries: boundaries })
      .turns[0];
    expect(rt?.wallMs).toBe(10_000); // 00:11 − 00:01
  });

  it("does not apply B boundaries to sidechain turns", () => {
    const c1 = call("2026-07-03T00:00:01.000Z", { isSidechain: true });
    const t = [turn("p1", [c1], { isSidechain: true })];
    const boundaries = [
      {
        sessionId: "s1",
        transcriptPath: "/x/s1.jsonl",
        turnEnd: "2026-07-03T00:00:11.000Z",
        turnEndEpoch: 0,
      },
    ];
    const rt = reconcilePremium([c1], t, { costSamples: [], turnBoundaries: boundaries }).turns[0];
    expect(rt?.wallMs).toBeUndefined();
  });

  it("uses L per-session totals when only L is present", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("p1", c)];
    const row: CostLogRow = {
      sessionId: "s1",
      timestamp: "2026-07-03T00:00:00.000Z",
      costUsd: 1.5,
      durationMs: 3000,
      model: "Sonnet",
      dir: "/x",
      contextPct: 45,
      cacheRead: 0,
      cacheWrite: 0,
      linesAdded: 16,
      linesRemoved: 8,
    };
    const s = reconcilePremium(c, t, {
      costSamples: [],
      turnBoundaries: [],
      costLogRow: row,
    }).session;
    expect(s.costObserved).toBe(1.5);
    expect(s.linesAdded).toBe(16);
    expect(s.contextPctObserved).toBeCloseTo(0.45);
  });

  it("lets C win over L for costObserved when both present", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("p1", c)];
    const row: CostLogRow = {
      sessionId: "s1",
      timestamp: "2026-07-03T00:00:00.000Z",
      costUsd: 99,
      durationMs: 0,
      model: "Sonnet",
      dir: "/x",
      contextPct: 90,
      cacheRead: 0,
      cacheWrite: 0,
      linesAdded: 100,
      linesRemoved: 100,
    };
    const s = reconcilePremium(c, t, {
      costSamples: [sample("2026-07-03T00:00:02.000Z", { costDeltaUsd: 0.2 })],
      turnBoundaries: [],
      costLogRow: row,
    }).session;
    expect(s.costObserved).toBeCloseTo(0.2); // C, not L's 99
  });

  it("attributes a pre-first-call sample to the first call (fallback)", () => {
    const c1 = call("2026-07-03T00:00:05.000Z");
    const t = [turn("p1", [c1])];
    const s = [sample("2026-07-03T00:00:01.000Z", { costDeltaUsd: 0.4 })]; // before c1
    const a1 = reconcilePremium([c1], t, { costSamples: s, turnBoundaries: [] }).calls[0];
    expect(a1?.costObserved).toBeCloseTo(0.4);
  });

  it("does not mutate the input call/turn objects", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const t = [turn("p1", [c1])];
    reconcilePremium([c1], t, {
      costSamples: [sample("2026-07-03T00:00:02.000Z")],
      turnBoundaries: [],
    });
    expect(c1.costObserved).toBeUndefined();
    expect(t[0]?.apiMs).toBeUndefined();
  });

  // T1 (review): L-only path does NOT propagate L's `durationMs` to
  // `wallMs`. The concern is that a future refactor might accidentally
  // source wallMs from costLogRow.durationMs (a per-session total that's
  // NOT per-turn). Without this pin, a fabricated value would leak.
  // The transcript-derived call span (endedAt - startedAt) is allowed
  // and is the H5 fallback — the test pins only "NOT durationMs".
  it("L-only path does not source wallMs from costLogRow.durationMs (T1)", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:04.000Z");
    const t = [turn("p1", [c1, c2])];
    const row: CostLogRow = {
      sessionId: "s1",
      timestamp: "2026-07-03T00:00:00.000Z",
      costUsd: 1.5,
      durationMs: 30_000, // intentionally very different from transcript span
      model: "Sonnet",
      dir: "/x",
      contextPct: 45,
      cacheRead: 0,
      cacheWrite: 0,
      linesAdded: 16,
      linesRemoved: 8,
    };
    const result = reconcilePremium([c1, c2], t, {
      costSamples: [],
      turnBoundaries: [],
      costLogRow: row,
    });
    // Transcript span (H5 fallback) = 00:04 - 00:01 = 3000 ms.
    // Anything else (especially row.durationMs = 30_000) would be a leak.
    expect(result.turns[0]?.wallMs).toBe(3000);
    // No observed C/B data → apiMs stays undefined.
    expect(result.turns[0]?.apiMs).toBeUndefined();
    expect(result.calls[0]?.apiMs).toBeUndefined();
    expect(result.calls[0]?.costObserved).toBeUndefined();
  });

  // M19 (review): when a B boundary's turnEnd precedes the turn's
  // startedAt (clock skew / out-of-order write), the negative span is
  // silently dropped — wallMs falls back to the transcript span (H5),
  // NOT to the (negative) B span. Locks both behaviors at once.
  it("does not set wallMs from a negative B boundary (M19) — falls back to transcript span (H5)", () => {
    const c1 = call("2026-07-03T00:00:05.000Z");
    const c2 = call("2026-07-03T00:00:09.000Z");
    const t = [turn("p1", [c1, c2])]; // turn span = 4s = 4000ms
    const boundaries = [
      {
        sessionId: "s1",
        transcriptPath: "/x/s1.jsonl",
        turnEnd: "2026-07-03T00:00:01.000Z", // before turn.startedAt = c1's timestamp
        turnEndEpoch: 0,
      },
    ];
    const rt = reconcilePremium([c1, c2], t, { costSamples: [], turnBoundaries: boundaries })
      .turns[0];
    // Falls back to transcript span (H5), NOT the negative B span.
    expect(rt?.wallMs).toBe(4000);
  });

  // H5 (review): when only C is present (no B file at all), wallMs falls
  // back to the transcript call span (endedAt - startedAt). Locks the
  // documented "degrades to call span" contract. (Tests with no C/B/L
  // data return early with no annotation — wallMs stays undefined; that's
  // a separate hot path.)
  it("wallMs falls back to transcript call span when C present but no B (H5)", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:06.000Z");
    const t = [turn("p1", [c1, c2])];
    const rt = reconcilePremium([c1, c2], t, {
      costSamples: [sample("2026-07-03T00:00:02.000Z")],
      turnBoundaries: [],
    }).turns[0];
    expect(rt?.wallMs).toBe(5000); // 00:06 - 00:01
  });

  // 🟢 #P4-14 §4 — promptId mismatch: a sample whose promptId matches
  // the turn's promptId does NOT increment the mismatch counter.
  it("does not count a sample whose promptId matches the turn", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("prompt-A", c)];
    const samples = [sample("2026-07-03T00:00:02.000Z", { promptId: "prompt-A" })];
    const s = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.promptIdMismatchCount).toBe(0);
  });

  // 🟢 #P4-14 §4 — mismatched promptIds DO increment the counter.
  it("counts each sample whose promptId does not match any turn", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("prompt-A", c)];
    const samples = [
      sample("2026-07-03T00:00:02.000Z", { promptId: "prompt-A" }),
      sample("2026-07-03T00:00:03.000Z", { promptId: "prompt-B" }),
      sample("2026-07-03T00:00:04.000Z", { promptId: "prompt-C" }),
    ];
    const s = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.promptIdMismatchCount).toBe(2);
  });

  // 🟢 #P4-14 §4 — samples WITHOUT a promptId are skipped (not
  // counted as mismatches), matching the documented "missing field is
  // skipped, not counted" discipline on the turn side. A statusline
  // that doesn't emit the field never inflates the counter.
  it("does not count samples without a promptId, even when turns carry one", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("prompt-A", c)];
    const samples = [
      sample("2026-07-03T00:00:02.000Z"), // no promptId
      sample("2026-07-03T00:00:03.000Z"), // no promptId
    ];
    const s = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.promptIdMismatchCount).toBe(0);
  });

  // 🟢 #P4-14 §4 — when no turn carries a promptId either, the §4
  // signal is undefined (no comparison possible) and the counter
  // stays quiet. This matches the architecture: the §4 panel renders
  // "no premium capture observed" when the counter is absent.
  it("does not count when no turn carries a promptId either", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [turn("", c)];
    const samples = [
      sample("2026-07-03T00:00:02.000Z", { promptId: "prompt-A" }),
      sample("2026-07-03T00:00:03.000Z", { promptId: "prompt-B" }),
    ];
    const s = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.promptIdMismatchCount).toBe(0);
  });

  // 🟢 #P4-14 §4 — unbucketed tail: a sample whose timestamp falls
  // INSIDE the turn's [startedAt, endedAt] range does NOT increment
  // the counter. The boundary inclusivity matters — a sample at the
  // exact turn-end timestamp is "bucketed" by this turn.
  it("does not count a sample inside the turn's [startedAt, endedAt] range", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:05.000Z");
    const t = [turn("p1", [c1, c2])]; // range [01, 05]
    const samples = [
      sample("2026-07-03T00:00:02.000Z"), // inside
      sample("2026-07-03T00:00:05.000Z"), // exactly at end (inclusive)
      sample("2026-07-03T00:00:01.000Z"), // exactly at start (inclusive)
    ];
    const s = reconcilePremium([c1, c2], t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.unbucketedTailCount).toBe(0);
  });

  // 🟢 #P4-14 §4 — a sample whose timestamp falls OUTSIDE every
  // turn's range DOES increment the counter (the "X samples sat
  // outside any turn" §4 sub-card).
  it("counts samples that fall outside every turn's range", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:05.000Z");
    const t = [turn("p1", [c1, c2])]; // range [01, 05]
    const samples = [
      sample("2026-07-03T00:00:00.000Z"), // before the turn
      sample("2026-07-03T00:00:06.000Z"), // after the turn
      sample("2026-07-03T00:00:02.000Z"), // inside (sanity)
    ];
    const s = reconcilePremium([c1, c2], t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.unbucketedTailCount).toBe(2);
  });

  // 🟢 #P4-14 §4 — a sample with an UNPARSEABLE timestamp is
  // skipped (not counted), matching the "missing field is skipped,
  // not counted" discipline. An invalid timestamp is morally "missing"
  // — neither bucketed nor unbucketed. The parseable sample sits
  // inside the turn range so it is also bucketed; only the
  // unparseable ones remain, and they must not contribute.
  it("does not count samples with an unparseable timestamp", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:05.000Z");
    const t = [turn("p1", [c1, c2])]; // range [01, 05]
    const samples = [
      sample("2026-07-03T00:00:02.000Z"), // parseable, inside
      sample("not-a-date"), // unparseable
      sample(""), // unparseable
    ];
    const s = reconcilePremium([c1, c2], t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.unbucketedTailCount).toBe(0);
  });

  // 🟢 #P4-14 §4 — when no turn has parseable startedAt/endedAt,
  // the §4 signal is undefined (no ranges to compare against) and
  // every sample's timestamp falls "outside" silently — counter stays
  // at zero. This matches the architecture: absent ranges = no
  // signal, no false-positive unbucketed counts.
  it("does not count when no turn has parseable time ranges", () => {
    const c = [call("2026-07-03T00:00:01.000Z")];
    const t = [
      {
        ...turn("p1", c),
        startedAt: "not-a-date",
        endedAt: "also-not-a-date",
      },
    ];
    const samples = [sample("2026-07-03T00:00:02.000Z"), sample("2026-07-03T00:00:03.000Z")];
    const s = reconcilePremium(c, t, { costSamples: samples, turnBoundaries: [] }).session;
    expect(s.unbucketedTailCount).toBe(0);
  });

  // 🟢 #P4-14 P-002 — sweeping-pointer algorithm: with K=10k samples
  // and T=1k turns, the per-sample scan used to be O(K × T) = 10M
  // comparisons. The new sweep is O((K + T) · active) where `active`
  // is the typical concurrency of overlapping ranges (usually 1 for
  // non-overlapping turn timelines). Pin correctness on a small
  // fixture that exercises overlapping turn ranges (sub-agent
  // scenario) so a future regression that breaks one but not the
  // other is caught by comparison.
  it("the sweep algorithm matches expectations on overlapping turn ranges", () => {
    const c1 = call("2026-07-03T00:00:01.000Z");
    const c2 = call("2026-07-03T00:00:09.000Z");
    // Two overlapping turns (sub-agent scenario): turn 2 starts before
    // turn 1 ends, so a sample at 00:00:04 sits in both — the sweep
    // must count it as bucketed because at least one range covers it.
    const t1 = turn("p1", [c1], {
      startedAt: "2026-07-03T00:00:01.000Z",
      endedAt: "2026-07-03T00:00:10.000Z",
    });
    const t2 = turn("p2", [c2], {
      startedAt: "2026-07-03T00:00:05.000Z",
      endedAt: "2026-07-03T00:00:15.000Z",
      isSidechain: true,
    });
    const samples = [
      sample("2026-07-03T00:00:04.000Z"), // inside both (sweep picks the max endMs)
      sample("2026-07-03T00:00:12.000Z"), // inside t2 only
      sample("2026-07-03T00:00:20.000Z"), // outside both
    ];
    const s = reconcilePremium([c1, c2], [t1, t2], {
      costSamples: samples,
      turnBoundaries: [],
    }).session;
    expect(s.unbucketedTailCount).toBe(1);
  });
});
