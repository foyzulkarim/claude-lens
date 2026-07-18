import { describe, expect, it } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import { attributeCacheMiss, classifyCacheWrite, K2_SPIKE_THRESHOLD } from "./classifier.js";

/**
 * Builds a minimal ApiCall. Required fields are filled with sensible
 * defaults so each test only spells out the parts that matter for the
 * classification branch under test. Uses deterministic ids/uuid strings
 * so failures print something readable.
 */
function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: "u-default",
    sessionId: "s1",
    messageId: "m-default",
    timestamp: "2026-07-03T12:00:00.000Z",
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

describe("classifyCacheWrite — strict spike boundary", () => {
  it("classifies only writes strictly above the K2 spike threshold", () => {
    // ARCH §A3 / gates.md K2 default — threshold is 10_000 with strict `>`.
    // Writes at or below the threshold are not classified (they aren't
    // "cache invalidations" by the gate's own definition).
    const stream = [
      call({ messageId: "m1", usage: { ...call().usage, cacheCreateTokens: 9_999 } }),
      call({ messageId: "m2", usage: { ...call().usage, cacheCreateTokens: 10_000 } }),
      call({ messageId: "m3", usage: { ...call().usage, cacheCreateTokens: 10_001 } }),
    ];

    expect(classifyCacheWrite(stream, 0)).toBeNull();
    expect(classifyCacheWrite(stream, 1)).toBeNull();
    expect(classifyCacheWrite(stream, 2)).not.toBeNull();
  });

  it("exposes the K2 spike threshold as the same 10_000 constant referenced by gates.md", () => {
    // Gates.md defaults row — keeping the constant exported and aligned
    // with the documented default lets a future Settings override
    // (#P4-15) substitute a single literal without diverging from the
    // gate's behavior.
    expect(K2_SPIKE_THRESHOLD).toBe(10_000);
  });
});

describe("classifyCacheWrite — K2 precedence", () => {
  it("returns first-call for the spike at index 0 of a stream", () => {
    const stream = [
      call({
        messageId: "m1",
        usage: { ...call().usage, cacheCreateTokens: 20_000, cacheCreate5m: 20_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 0);
    expect(result?.baseCause).toBe("first-call");
    expect(result?.trace.isFirstCall).toBe(true);
  });

  it("returns model-switch when the current call's model differs from the previous", () => {
    const stream = [
      call({
        messageId: "m0",
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m1",
        model: "claude-fable-5",
        usage: { ...call().usage, cacheCreateTokens: 25_000, cacheCreate5m: 25_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 1);
    expect(result?.baseCause).toBe("model-switch");
    expect(result?.trace.modelSwitched).toBe(true);
    expect(result?.trace.previousModel).toBe("claude-sonnet-5");
  });

  it("returns compaction when the previous read is more than 50% lower than the read before it", () => {
    // Previous read = 100, before-previous read = 1000 → fall of 90%.
    // The K2 rule is "more than 50% lower" (strict) — exactly 50% is NOT
    // compaction (see the boundary test below).
    const stream = [
      call({
        messageId: "m0",
        usage: { ...call().usage, cacheReadTokens: 1000, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m1",
        usage: { ...call().usage, cacheReadTokens: 100, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m2",
        usage: { ...call().usage, cacheCreateTokens: 50_000, cacheCreate1h: 50_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 2);
    expect(result?.baseCause).toBe("compaction");
    expect(result?.trace.compactionDetected).toBe(true);
    expect(result?.trace.compactionRatio).toBeCloseTo(0.9, 5);
  });

  it("treats exactly 50% as NOT compaction (strict `more than 50% lower`)", () => {
    // Previous read = 500, before-previous read = 1000 → fall of exactly
    // 50%. The K2 rule says "more than 50% lower" — strict comparison.
    const stream = [
      call({
        messageId: "m0",
        usage: { ...call().usage, cacheReadTokens: 1000, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m1",
        usage: { ...call().usage, cacheReadTokens: 500, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m2",
        usage: { ...call().usage, cacheCreateTokens: 30_000, cacheCreate5m: 30_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 2);
    expect(result?.baseCause).toBe("unexplained");
    expect(result?.trace.compactionDetected).toBe(false);
    expect(result?.trace.compactionRatio).toBeCloseTo(0.5, 5);
  });

  it("returns unexplained when no earlier rule matched and there is enough history", () => {
    // Previous model same as current; previous read = before-previous read
    // (no compaction). Spike at index 2 with no qualifying prior signal
    // → "unexplained".
    const stream = [
      call({
        messageId: "m0",
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheReadTokens: 1000, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m1",
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheReadTokens: 1000, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m2",
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheCreateTokens: 40_000, cacheCreate5m: 40_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 2);
    expect(result?.baseCause).toBe("unexplained");
    expect(result?.trace.isFirstCall).toBe(false);
    expect(result?.trace.modelSwitched).toBe(false);
    expect(result?.trace.compactionDetected).toBe(false);
  });

  it("records every check and value in the trace regardless of which rule matched", () => {
    // First-match-wins, but every prior check's outcome must be recorded
    // so downstream consumers (the gates engine, the analyzer's audit
    // log) can reconstruct why a spike landed where it did without
    // re-running the classifier.
    const stream = [
      call({
        messageId: "m0",
        model: "claude-sonnet-5",
        usage: { ...call().usage, cacheReadTokens: 1000, cacheCreateTokens: 0 },
      }),
      call({
        messageId: "m1",
        model: "claude-fable-5",
        usage: { ...call().usage, cacheCreateTokens: 11_000, cacheCreate5m: 11_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 1);
    expect(result?.baseCause).toBe("model-switch");
    // Even though we matched on model-switch, the first-call check was
    // performed (and recorded as false), and the compaction check was
    // skipped because there is no before-previous call.
    expect(result?.trace.isFirstCall).toBe(false);
    expect(result?.trace.beforePreviousCacheReadTokens).toBeNull();
    expect(result?.trace.compactionRatio).toBeNull();
  });
});

describe("attributeCacheMiss — TTL attribution overlay", () => {
  function baseClassification(overrides: Partial<ReturnType<typeof classifyCacheWrite>> = {}) {
    return {
      baseCause: "unexplained" as const,
      trace: {
        isFirstCall: false,
        previousModel: "claude-sonnet-5",
        modelSwitched: false,
        previousCacheReadTokens: 1000,
        beforePreviousCacheReadTokens: 1000,
        compactionRatio: 0,
        compactionDetected: false,
        ttlGapMs: 60_000,
        represented5m: true,
        represented1h: false,
      },
      ...overrides,
    };
  }

  it("returns ttl-lapse when the gap exceeds every represented TTL bucket", () => {
    // 5m bucket = 5 minutes = 300_000 ms; gap = 10 minutes (600_000 ms)
    // → definitively beyond the represented TTL.
    const classification = baseClassification({
      trace: { ...baseClassification().trace, ttlGapMs: 600_000, represented5m: true },
    });
    const current = call({
      usage: { ...call().usage, cacheCreateTokens: 20_000, cacheCreate5m: 20_000 },
    });
    const previous = call({ timestamp: "2026-07-03T12:00:00.000Z" });

    expect(attributeCacheMiss(classification, current, previous)).toBe("ttl-lapse");
  });

  it("returns prefix-change when the gap is within every represented TTL and the cause is unexplained", () => {
    // 1h bucket = 3_600_000 ms; gap = 5 minutes (300_000 ms) — well
    // within the TTL. Cause is "unexplained", so the cache was almost
    // certainly invalidated by a prefix change (not TTL expiry).
    const classification = baseClassification({
      trace: { ...baseClassification().trace, ttlGapMs: 300_000, represented1h: true },
    });
    const current = call({
      usage: { ...call().usage, cacheCreateTokens: 25_000, cacheCreate1h: 25_000 },
    });
    const previous = call({ timestamp: "2026-07-03T11:55:00.000Z" });

    expect(attributeCacheMiss(classification, current, previous)).toBe("prefix-change");
  });

  it("returns unknown when the gap is within the TTL but the cause is first-call or model-switch", () => {
    // A spike whose cause is already explained (first-call or model-
    // switch) does not need a TTL attribution; the gap is irrelevant.
    // Per ARCH §A4 the overlay returns "unknown" — not "prefix-change"
    // — so the UI's verdict chip never claims TTL evidence that
    // contradicts the K2 cause.
    const forFirstCall = baseClassification({
      baseCause: "first-call",
      trace: { ...baseClassification().trace, ttlGapMs: 60_000 },
    });
    const current = call({
      usage: { ...call().usage, cacheCreateTokens: 15_000, cacheCreate5m: 15_000 },
    });
    const previous = call({ timestamp: "2026-07-03T11:59:00.000Z" });

    expect(attributeCacheMiss(forFirstCall, current, previous)).toBe("unknown");
  });

  it("returns unknown when represented buckets are mixed (partial expiry ambiguous)", () => {
    // Both 5m and 1h non-zero in the same write → the cache write
    // itself is mixed, so partial expiry cannot be distinguished from a
    // prefix change. Honest unknown.
    const classification = baseClassification({
      trace: {
        ...baseClassification().trace,
        ttlGapMs: 600_000, // beyond 5m, within 1h
        represented5m: true,
        represented1h: true,
      },
    });
    const current = call({
      usage: {
        ...call().usage,
        cacheCreateTokens: 30_000,
        cacheCreate5m: 15_000,
        cacheCreate1h: 15_000,
      },
    });
    const previous = call({ timestamp: "2026-07-03T11:50:00.000Z" });

    expect(attributeCacheMiss(classification, current, previous)).toBe("unknown");
  });

  it("returns unknown when the represented-bucket fields are missing entirely", () => {
    // Real transcripts sometimes omit cache_creation.ephemeral_*_input_tokens;
    // the parser leaves cacheCreate5m/1h undefined. Without either
    // bucket we cannot tell whether the gap is "beyond the TTL" or
    // "within the TTL" — always unknown.
    const classification = baseClassification({
      trace: {
        ...baseClassification().trace,
        ttlGapMs: 999_999,
        represented5m: false,
        represented1h: false,
      },
    });
    const current = call({
      usage: { ...call().usage, cacheCreateTokens: 20_000 }, // no 5m / 1h fields
    });
    const previous = call({ timestamp: "2026-07-03T11:30:00.000Z" });

    expect(attributeCacheMiss(classification, current, previous)).toBe("unknown");
  });

  it("returns unknown for malformed timestamps instead of emitting NaN", () => {
    // ARCH forward stress-test: a Date.parse failure must not propagate
    // as NaN into the response. The classifier caps ttlGapMs at null
    // when either timestamp is unparseable.
    const classification = baseClassification({
      trace: { ...baseClassification().trace, ttlGapMs: null, represented5m: true },
    });
    const current = call({
      usage: { ...call().usage, cacheCreateTokens: 20_000, cacheCreate5m: 20_000 },
    });
    const previous = call({ timestamp: "not-a-date" });

    expect(attributeCacheMiss(classification, current, previous)).toBe("unknown");
  });

  it("returns unknown for the first call (no previous → no TTL evidence)", () => {
    const classification = baseClassification({
      baseCause: "first-call",
      trace: { ...baseClassification().trace, isFirstCall: true, ttlGapMs: null },
    });
    const current = call({
      usage: { ...call().usage, cacheCreateTokens: 15_000, cacheCreate5m: 15_000 },
    });

    expect(attributeCacheMiss(classification, current, undefined)).toBe("unknown");
  });
});

describe("classifyCacheWrite — TTL trace facts populated", () => {
  it("records the idle gap and represented buckets even on non-spike calls (for the trace downstream)", () => {
    // The trace's ttlGapMs / represented5m / represented1h fields must
    // be filled regardless of whether the spike threshold matched —
    // they're the facts `attributeCacheMiss` reads back, and the
    // analyzer may want to audit them on every classified event.
    // (For calls under the threshold classifyCacheWrite returns null;
    // this test pins down that the trace fields it WOULD have produced
    // are computable. The attribute tests above pin the overlay logic.)
    const stream = [
      call({
        messageId: "m0",
        timestamp: "2026-07-03T12:00:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 0, cacheReadTokens: 500 },
      }),
      call({
        messageId: "m1",
        timestamp: "2026-07-03T12:01:00.000Z",
        usage: { ...call().usage, cacheCreateTokens: 12_000, cacheCreate5m: 12_000 },
      }),
    ];

    const result = classifyCacheWrite(stream, 1);
    expect(result?.trace.ttlGapMs).toBe(60_000);
    expect(result?.trace.represented5m).toBe(true);
    expect(result?.trace.represented1h).toBe(false);
  });
});
