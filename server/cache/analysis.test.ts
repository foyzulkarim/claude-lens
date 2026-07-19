import { describe, expect, it } from "vitest";
import type { CacheLabQuery } from "../../shared/cache-lab-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";
import { DEFAULT_PRICING_TABLE } from "../metrics/measures.js";
import { type AnalysisInput, analyzeCacheLab } from "./analysis.js";

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: "u-default",
    sessionId: "s1",
    messageId: "m-default",
    timestamp: "2026-06-10T10:00:00.000Z",
    model: "claude-sonnet-5",
    usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function baseQuery(): CacheLabQuery {
  return {
    range: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T23:59:59.000Z" },
    grain: "day",
  };
}

describe("analyzeCacheLab — stream partitioning", () => {
  it("keeps main and sidechain-agent adjacency independent", () => {
    // A sidechain call interleaved with main calls must NOT corrupt the
    // main stream's evidence — its K2 cause uses only main-thread
    // neighbors. (Architecture decision A3 + the classifier invariant.)
    const calls: ApiCall[] = [
      call({
        uuid: "m1",
        sessionId: "s1",
        messageId: "m1",
        timestamp: "2026-06-10T10:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 5_000, cacheCreate5m: 5_000 },
      }),
      // Sidechain call between two main calls.
      call({
        uuid: "sc1",
        sessionId: "s1",
        messageId: "sc1",
        timestamp: "2026-06-10T10:00:01.000Z",
        isSidechain: true,
        agentId: "agent-x",
        usage: { ...call().usage, cacheCreateTokens: 15_000, cacheCreate5m: 15_000 },
      }),
      call({
        uuid: "m2",
        sessionId: "s1",
        messageId: "m2",
        timestamp: "2026-06-10T10:00:02.000Z",
        usage: { ...call().usage, cacheCreateTokens: 11_000, cacheCreate5m: 11_000 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    // The main stream's m2 spike sees m1 as its previous (not sc1).
    // Since m1's model = m2's model and there's no compaction
    // evidence, m2 = "unexplained" with attribution depending on gap.
    // The sidechain spike at sc1 is its own stream's first call →
    // "first-call" (and never contributes to main-stream counts).
    const sidechainGallery = result.gallery.items.find((i) => i.callId === "sc1");
    expect(sidechainGallery?.baseCause).toBe("first-call");
    expect(sidechainGallery?.streamKey).toBe("agent-x");
  });
});

describe("analyzeCacheLab — full-history classification before filtering", () => {
  it("classifies a spike whose previous-call evidence predates the range boundary", () => {
    // Spike at T = 2026-06-15 with a previous call at T - 1 hour. Range
    // begins at T (the spike is in range) but the previous call is
    // outside range. Decision A6: classification must still see the
    // previous call's read tokens so compaction evidence survives.
    const calls: ApiCall[] = [
      call({
        uuid: "p",
        sessionId: "s1",
        messageId: "p",
        timestamp: "2026-06-15T09:00:00.000Z",
        usage: {
          ...call().usage,
          cacheCreateTokens: 5_000,
          cacheReadTokens: 5000,
          cacheCreate5m: 5_000,
        },
      }),
      call({
        uuid: "n",
        sessionId: "s1",
        messageId: "n",
        timestamp: "2026-06-15T10:00:00.000Z",
        usage: {
          ...call().usage,
          cacheCreateTokens: 100,
          cacheReadTokens: 500,
          cacheCreate5m: 100,
        },
      }),
      call({
        uuid: "sp",
        sessionId: "s1",
        messageId: "sp",
        timestamp: "2026-06-15T11:00:00.000Z",
        usage: {
          ...call().usage,
          cacheCreateTokens: 50_000,
          cacheReadTokens: 100,
          cacheCreate1h: 50_000,
        },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      {
        ...baseQuery(),
        range: { from: "2026-06-15T11:00:00.000Z", to: "2026-06-15T23:59:59.000Z" },
      },
    );

    // The previous-call context survives the range boundary, so the
    // spike reads (prev=100, before-prev=5000) → 98% compaction, not
    // "first-call" (which it would be if we filtered before classifying).
    const spike = result.gallery.items.find((i) => i.callId === "sp");
    expect(spike?.baseCause).toBe("compaction");
  });
});

describe("analyzeCacheLab — economics + nullability", () => {
  it("computes a reconciled cache-economic ledger without double counting", () => {
    // 2 calls, fully priced: 1 normal (savings) + 1 bust (loss).
    // Net = savings - bust loss.
    const calls: ApiCall[] = [
      call({
        uuid: "a",
        sessionId: "s1",
        messageId: "a",
        timestamp: "2026-06-10T10:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 0, cacheReadTokens: 1_000_000 },
      }),
      call({
        uuid: "b",
        sessionId: "s1",
        messageId: "b",
        timestamp: "2026-06-10T11:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    const rate = DEFAULT_PRICING_TABLE["claude-sonnet-5"];
    // Cache savings = (uncached - actual) per call.
    // For call "a": input=100 + cacheRead=1_000_000 → uncached at input rate,
    //              actual at cacheRead rate. Savings = 1_000_000 * (input - cacheRead).
    // Bust loss = cacheCreateTokens * (cacheCreate - cacheRead) = 12_000 * (6.25 - 0.5) / 1e6.
    const expectedBust = (12_000 * (rate.cacheCreate - rate.cacheRead)) / 1_000_000;
    expect(result.economics.bustLoss).toBeCloseTo(expectedBust, 5);
    expect(result.economics.bustCount).toBe(1);
    expect(result.economics.pricingComplete).toBe(true);
    expect(result.economics.netBenefit).toBeLessThan(result.economics.cacheSavings ?? 0);
  });

  it("keeps tokens available when pricing is incomplete (unpriced model)", () => {
    // Two priced calls establish history; one unpriced-model call spikes.
    // The spike lands on model-switch (not first-call) so it counts
    // toward busts — exercising the "pricingComplete: false but
    // bustCount still populated" branch.
    const calls: ApiCall[] = [
      call({
        uuid: "u1",
        sessionId: "s1",
        messageId: "u1",
        timestamp: "2026-06-10T10:00:00.000Z",
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheCreateTokens: 100, cacheCreate5m: 100 },
      }),
      call({
        uuid: "u2",
        sessionId: "s1",
        messageId: "u2",
        timestamp: "2026-06-10T10:01:00.000Z",
        model: "claude-mystery-future-model",
        usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    expect(result.economics.pricingComplete).toBe(false);
    expect(result.economics.actualCost).toBeNull();
    expect(result.economics.cacheSavings).toBeNull();
    expect(result.economics.uncachedCost).toBeNull();
    expect(result.economics.netBenefit).toBeNull();
    // bustCount is still populated (it doesn't need pricing); bustLoss
    // collapses to null because the bust's model is unpriced.
    expect(result.economics.bustCount).toBe(1);
    expect(result.economics.bustLoss).toBeNull();
    // Attribution + TTL mix + gallery still computed.
    expect(result.attribution.unknownCount).toBeGreaterThanOrEqual(0);
    expect(result.ttlMix.ephemeral5mTokens).toBe(100 + 12_000);
  });

  it("ignores an unpriced model outside the requested scope", () => {
    const calls: ApiCall[] = [
      call({
        uuid: "priced",
        sessionId: "s1",
        messageId: "priced",
        timestamp: "2026-06-10T10:00:00.000Z",
      }),
      call({
        uuid: "out-of-range-unpriced",
        sessionId: "s2",
        messageId: "out-of-range-unpriced",
        model: "claude-mystery-future-model",
        timestamp: "2025-01-01T10:00:00.000Z",
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    expect(result.economics.pricingComplete).toBe(true);
    expect(result.economics.actualCost).not.toBeNull();
  });
});

describe("analyzeCacheLab — TTL mix reconciliation", () => {
  it("reconciles 5m + 1h + unknown = total cacheCreateTokens", () => {
    const calls: ApiCall[] = [
      // 5m-only write
      call({
        uuid: "m1",
        sessionId: "s1",
        messageId: "m1",
        timestamp: "2026-06-10T10:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 10_000, cacheCreate5m: 10_000 },
      }),
      // 1h-only write
      call({
        uuid: "m2",
        sessionId: "s1",
        messageId: "m2",
        timestamp: "2026-06-10T11:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 20_000, cacheCreate1h: 20_000 },
      }),
      // Both buckets populated
      call({
        uuid: "m3",
        sessionId: "s1",
        messageId: "m3",
        timestamp: "2026-06-10T12:00:00.000Z",
        usage: {
          ...call().usage,
          cacheCreateTokens: 30_000,
          cacheCreate5m: 15_000,
          cacheCreate1h: 15_000,
        },
      }),
      // Missing buckets entirely → all unknown
      call({
        uuid: "m4",
        sessionId: "s1",
        messageId: "m4",
        timestamp: "2026-06-10T13:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 25_000 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    expect(result.ttlMix.ephemeral5mTokens).toBe(10_000 + 15_000); // m1 + half of m3
    expect(result.ttlMix.ephemeral1hTokens).toBe(20_000 + 15_000); // m2 + half of m3
    expect(result.ttlMix.unknownTokens).toBe(25_000); // m4
    expect(
      result.ttlMix.ephemeral5mTokens +
        result.ttlMix.ephemeral1hTokens +
        result.ttlMix.unknownTokens,
    ).toBe(10_000 + 20_000 + 30_000 + 25_000);
  });
});

describe("analyzeCacheLab — baseline weight trend", () => {
  // Local-ISO helper — same convention as server/metrics/engine.test.ts
  // because bucket boundaries are computed by local-time getters.
  function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
    return new Date(y, mo, d, h, mi).toISOString();
  }

  it("emits dense grain buckets with median + sample count; empty buckets honest-null", () => {
    // Two sessions with their own first cache write at different local days.
    const calls: ApiCall[] = [
      call({
        uuid: "s1c1",
        sessionId: "s1",
        messageId: "s1c1",
        timestamp: iso(2026, 5, 10, 10, 0),
        usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
      }),
      call({
        uuid: "s1c2",
        sessionId: "s1",
        messageId: "s1c2",
        timestamp: iso(2026, 5, 10, 10, 1),
        usage: {
          ...call().usage,
          cacheCreateTokens: 100,
          cacheReadTokens: 12_000,
          cacheCreate5m: 100,
        },
      }),
      call({
        uuid: "s2c1",
        sessionId: "s2",
        messageId: "s2c1",
        timestamp: iso(2026, 5, 12, 14, 0),
        usage: { ...call().usage, cacheCreateTokens: 18_000, cacheCreate5m: 18_000 },
      }),
      call({
        uuid: "s2c2",
        sessionId: "s2",
        messageId: "s2c2",
        timestamp: iso(2026, 5, 12, 14, 1),
        usage: {
          ...call().usage,
          cacheCreateTokens: 200,
          cacheReadTokens: 18_000,
          cacheCreate5m: 200,
        },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      { ...baseQuery(), range: { from: iso(2026, 5, 10, 0, 0), to: iso(2026, 5, 13, 23, 59) } },
    );

    // Four day buckets (10, 11, 12, 13). s1 → bucket 10. s2 → bucket 12.
    // Buckets 11 and 13 must be empty (null median, 0 sample count).
    expect(result.baseline.points).toHaveLength(4);
    const points = result.baseline.points;
    // s1 contribution: day-10 bucket, median 12000, count 1
    const day10 = points.find((p) => p.t === iso(2026, 5, 10, 0, 0));
    expect(day10?.medianTokens).toBe(12_000);
    expect(day10?.sampleCount).toBe(1);
    // s2 contribution: day-12 bucket, median 18000, count 1
    const day12 = points.find((p) => p.t === iso(2026, 5, 12, 0, 0));
    expect(day12?.medianTokens).toBe(18_000);
    expect(day12?.sampleCount).toBe(1);
    // Empty buckets: day-11 and day-13
    const day11 = points.find((p) => p.t === iso(2026, 5, 11, 0, 0));
    const day13 = points.find((p) => p.t === iso(2026, 5, 13, 0, 0));
    expect(day11?.medianTokens).toBeNull();
    expect(day11?.sampleCount).toBe(0);
    expect(day13?.medianTokens).toBeNull();
    expect(day13?.sampleCount).toBe(0);
  });
});

describe("analyzeCacheLab — invalidation cost trend bounds", () => {
  // Local-ISO helper — same convention as server/metrics/engine.test.ts.
  function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
    return new Date(y, mo, d, h, mi).toISOString();
  }

  it("excludes first-call spikes from invalidation cost; emits dense buckets", () => {
    // 3 spikes in 3 days: 1 first-call (excluded), 1 model-switch,
    // 1 unexplained. Dense day buckets even when some are empty.
    const calls: ApiCall[] = [
      // Day 1: first-call spike (excluded from invalidation cost)
      call({
        uuid: "d1",
        sessionId: "s1",
        messageId: "d1",
        timestamp: iso(2026, 5, 10, 10, 0),
        usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
      }),
      // Day 2: model-switch spike (sonnet → fable at this call)
      call({
        uuid: "d2a",
        sessionId: "s1",
        messageId: "d2a",
        timestamp: iso(2026, 5, 11, 10, 0),
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheCreateTokens: 200, cacheCreate5m: 200 },
      }),
      call({
        uuid: "d2b",
        sessionId: "s1",
        messageId: "d2b",
        timestamp: iso(2026, 5, 11, 11, 0),
        model: "claude-fable-5",
        usage: { ...call().usage, cacheCreateTokens: 20_000, cacheCreate5m: 20_000 },
      }),
      // Day 3: unexplained spike (same model as previous, no compaction)
      call({
        uuid: "d3a",
        sessionId: "s1",
        messageId: "d3a",
        timestamp: iso(2026, 5, 12, 10, 0),
        model: "claude-fable-5",
        usage: { ...call().usage, cacheCreateTokens: 200, cacheCreate5m: 200 },
      }),
      call({
        uuid: "d3b",
        sessionId: "s1",
        messageId: "d3b",
        timestamp: iso(2026, 5, 12, 11, 0),
        model: "claude-fable-5",
        usage: { ...call().usage, cacheCreateTokens: 15_000, cacheCreate5m: 15_000 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      { ...baseQuery(), range: { from: iso(2026, 5, 10, 0, 0), to: iso(2026, 5, 13, 23, 59) } },
    );

    expect(result.invalidationCost.points).toHaveLength(4);
    const day10 = result.invalidationCost.points.find((p) => p.t === iso(2026, 5, 10, 0, 0));
    const day11 = result.invalidationCost.points.find((p) => p.t === iso(2026, 5, 11, 0, 0));
    const day12 = result.invalidationCost.points.find((p) => p.t === iso(2026, 5, 12, 0, 0));
    // Day 10: first-call only — all causes null (no invalidation).
    expect(day10?.modelSwitch).toBeNull();
    expect(day10?.compaction).toBeNull();
    expect(day10?.unexplained).toBeNull();
    // Day 11: model-switch contributes.
    expect(day11?.modelSwitch).not.toBeNull();
    expect(day11?.modelSwitch ?? 0).toBeGreaterThan(0);
    expect(day11?.compaction).toBeNull();
    // Day 12: unexplained contributes.
    expect(day12?.unexplained).not.toBeNull();
    expect(day12?.unexplained ?? 0).toBeGreaterThan(0);
  });
});

describe("analyzeCacheLab — gallery bounds", () => {
  it("caps gallery at CACHE_LAB_LIMITS.GALLERY_MAX_ITEMS newest-first with honest total + truncated", () => {
    const calls: ApiCall[] = [];
    for (let i = 0; i < 60; i++) {
      calls.push(
        call({
          uuid: `g${i}`,
          sessionId: `s${i}`,
          messageId: `g${i}`,
          // Spread across 60 days so all are in range.
          timestamp: new Date(Date.UTC(2026, 5, 1 + i, 10, 0)).toISOString(),
          usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
        }),
      );
    }

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      {
        ...baseQuery(),
        range: { from: "2026-06-01T00:00:00.000Z", to: "2026-09-30T23:59:59.000Z" },
      },
    );

    expect(result.gallery.items).toHaveLength(50);
    expect(result.gallery.total).toBe(60);
    expect(result.gallery.truncated).toBe(true);
    // Newest first — first item's timestamp >= last item's.
    expect(result.gallery.items[0]?.timestamp >= result.gallery.items[49]?.timestamp).toBe(true);
  });
});

describe("analyzeCacheLab — context growth bounds + finite data", () => {
  it("caps context curves at CACHE_LAB_LIMITS.CONTEXT_MAX_CURVES, highest-peak first, with honest totals", () => {
    // 30 sessions, each with one turn containing one call with varying
    // inputTokens so we can verify the peak-descending sort.
    const calls: ApiCall[] = [];
    const turns: Turn[] = [];
    for (let i = 0; i < 30; i++) {
      const ts = new Date(Date.UTC(2026, 5, 10, 10, 0)).toISOString();
      const c: ApiCall = call({
        uuid: `c${i}`,
        sessionId: `s${i}`,
        messageId: `c${i}`,
        timestamp: ts,
        promptId: `p${i}`,
        usage: {
          ...call().usage,
          inputTokens: 1000 * (i + 1),
          cacheCreateTokens: 5_000,
          cacheCreate5m: 5_000,
        },
      });
      calls.push(c);
      turns.push({
        promptId: `p${i}`,
        sessionId: `s${i}`,
        isSidechain: false,
        startedAt: ts,
        endedAt: ts,
        calls: [c],
        usage: {
          inputTokens: 1000 * (i + 1),
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheCreateTokens: 5_000,
          cacheCreate5m: 5_000,
        },
        toolResultBytes: 0,
      });
    }

    const result = analyzeCacheLab(
      { calls, turns, sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    expect(result.contextGrowth.curves).toHaveLength(24);
    expect(result.contextGrowth.total).toBe(30);
    expect(result.contextGrowth.truncated).toBe(true);
    expect(result.contextGrowth.basis).toBe("token-estimated");
    // Highest peak first: session s29 (30000 input) > session s0 (1000).
    expect(result.contextGrowth.curves[0]?.sessionId).toBe("s29");
    expect(result.contextGrowth.curves[0]?.points[0]?.inputTokens).toBe(30_000);
  });

  it("keeps every chart point finite (no NaN / Infinity)", () => {
    // A pathological call with parseable timestamp but no input/output
    // tokens must not poison the curve point math.
    const ts = new Date(Date.UTC(2026, 5, 10, 10, 0)).toISOString();
    const c: ApiCall = call({
      uuid: "c1",
      sessionId: "s1",
      messageId: "c1",
      timestamp: ts,
      promptId: "p1",
      usage: { ...call().usage, inputTokens: 0, cacheCreateTokens: 5_000, cacheCreate5m: 5_000 },
    });
    const t: Turn = {
      promptId: "p1",
      sessionId: "s1",
      isSidechain: false,
      startedAt: ts,
      endedAt: ts,
      calls: [c],
      usage: {
        inputTokens: 0,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreateTokens: 5_000,
        cacheCreate5m: 5_000,
      },
      toolResultBytes: 0,
    };

    const result = analyzeCacheLab(
      { calls: [c], turns: [t], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    // The curve should not include the zero-input point (per the
    // skip-zero guard) — and definitely no NaN.
    for (const curve of result.contextGrowth.curves) {
      for (const point of curve.points) {
        expect(Number.isFinite(point.inputTokens)).toBe(true);
        expect(
          Number.isFinite(point.timestamp.length ? new Date(point.timestamp).getTime() : 0),
        ).toBe(true);
      }
    }
  });
});

describe("analyzeCacheLab — attribution verdict", () => {
  it("reports 'no-events' when no spikes were classified", () => {
    const calls: ApiCall[] = [
      call({
        uuid: "a",
        sessionId: "s1",
        messageId: "a",
        timestamp: "2026-06-10T10:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 0 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    expect(result.attribution.ttlLapseCount).toBe(0);
    expect(result.attribution.prefixChangeCount).toBe(0);
    expect(result.attribution.unknownCount).toBe(0);
    expect(result.attribution.verdict).toBe("no-events");
  });

  it("reports 'mixed' when both TTL-lapse and prefix-change spikes coexist", () => {
    // Two streams (separate sessions to keep adjacency clean):
    //   Session s1: prefix-change (gap within TTL, unknown base cause)
    //   Session s2: ttl-lapse (gap beyond 5m TTL, unknown base cause)
    const calls: ApiCall[] = [
      // s1 — prefix change
      call({
        uuid: "s1p",
        sessionId: "s1",
        messageId: "s1p",
        timestamp: "2026-06-10T10:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 100, cacheCreate5m: 100 },
      }),
      call({
        uuid: "s1s",
        sessionId: "s1",
        messageId: "s1s",
        timestamp: "2026-06-10T10:01:00.000Z", // 1-minute gap, within 5m TTL
        usage: { ...call().usage, cacheCreateTokens: 15_000, cacheCreate5m: 15_000 },
      }),
      // s2 — TTL lapse
      call({
        uuid: "s2p",
        sessionId: "s2",
        messageId: "s2p",
        timestamp: "2026-06-10T12:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 100, cacheCreate5m: 100 },
      }),
      call({
        uuid: "s2s",
        sessionId: "s2",
        messageId: "s2s",
        timestamp: "2026-06-10T12:10:00.000Z", // 10-minute gap, beyond 5m TTL
        usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
      }),
    ];

    const result = analyzeCacheLab(
      { calls, turns: [], sessions: [], pricing: DEFAULT_PRICING_TABLE },
      baseQuery(),
    );

    expect(result.attribution.ttlLapseCount).toBe(1);
    expect(result.attribution.prefixChangeCount).toBe(1);
    expect(result.attribution.verdict).toBe("mixed");
  });
});

// Suppress unused-import lint when types are imported only for shape
// documentation (no value usage in this file).
type _Doc = Pick<AnalysisInput, "calls" | "turns" | "sessions" | "pricing">;
