import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import { evaluateK2 } from "./k2.js";

function turn(promptId: string, calls: ApiCall[]): Turn {
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: "2026-07-01T00:00:00.000Z",
    calls,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    toolResultBytes: 0,
  };
}

function call(
  messageId: string,
  timestamp: string,
  model: string,
  cacheCreateTokens: number,
  cacheReadTokens = 0,
): ApiCall {
  return {
    uuid: `u-${messageId}`,
    sessionId: "s1",
    messageId,
    timestamp,
    model,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens,
      cacheCreateTokens,
    },
    isSidechain: false,
    tools: [],
    cwd: "/test",
    gitBranch: "",
    version: "",
    entrypoint: "",
  };
}

describe("K2 — Unexplained cache invalidation", () => {
  it("passes when no call has cacheCreateTokens above the threshold", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", "claude-sonnet-5", 5_000),
      call("m2", "2026-07-01T00:00:01.000Z", "claude-sonnet-5", 8_000),
    ];
    const result = evaluateK2([turn("p1", calls)], calls, { k2Spike: 10_000 });
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("does not fire on the first call (first-call branch — explained)", () => {
    const calls = [call("m1", "2026-07-01T00:00:00.000Z", "claude-sonnet-5", 15_000)];
    const result = evaluateK2([turn("p1", calls)], calls, { k2Spike: 10_000 });
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("does not fire on a model switch (model-switch branch — explained)", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", "claude-sonnet-5", 5_000, 0),
      call("m2", "2026-07-01T00:00:01.000Z", "claude-sonnet-5", 5_000, 10_000),
      // Spike after a model switch is "explained"
      call("m3", "2026-07-01T00:00:02.000Z", "claude-fable-5", 15_000, 0),
    ];
    const result = evaluateK2([turn("p1", calls)], calls, { k2Spike: 10_000 });
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("does not fire on a compaction (compaction branch — explained)", () => {
    // At m3: previous=m2 (cacheRead=5_000), before-previous=m1 (cacheRead=20_000).
    // Ratio = (20_000 - 5_000) / 20_000 = 0.75 > 0.5 → compactionDetected = true.
    // m3's cacheCreateTokens spike is therefore "explained" by the compaction.
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", "claude-sonnet-5", 5_000, 20_000),
      call("m2", "2026-07-01T00:00:01.000Z", "claude-sonnet-5", 5_000, 5_000),
      call("m3", "2026-07-01T00:00:02.000Z", "claude-sonnet-5", 15_000, 1_000),
    ];
    const result = evaluateK2([turn("p1", calls)], calls, { k2Spike: 10_000 });
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("fires when an above-threshold spike has no explanation (unexplained)", () => {
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", "claude-sonnet-5", 5_000, 0),
      call("m2", "2026-07-01T00:00:01.000Z", "claude-sonnet-5", 5_000, 10_000),
      // Spike with same model, same-or-higher read baseline → no branch fires → unexplained
      call("m3", "2026-07-01T00:00:02.000Z", "claude-sonnet-5", 15_000, 12_000),
    ];
    const result = evaluateK2([turn("p1", calls)], calls, { k2Spike: 10_000 });
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(1);
    // Detail should embed the classifier trace; report which branch fired.
    expect(result.evidence[0]?.detail).toContain("baseCause=unexplained");
    expect(result.evidence[0]?.detail).toContain("cacheCreateTokens=15000");
  });

  it("respects the threshold override (R13 — fixture branch coverage)", () => {
    // With k2Spike=5_000, every spike here is above threshold.
    const calls = [
      call("m1", "2026-07-01T00:00:00.000Z", "claude-sonnet-5", 6_000, 0),
      call("m2", "2026-07-01T00:00:01.000Z", "claude-sonnet-5", 6_000, 12_000),
      call("m3", "2026-07-01T00:00:02.000Z", "claude-sonnet-5", 6_000, 12_000), // no explanation
    ];
    const result = evaluateK2([turn("p1", calls)], calls, { k2Spike: 5_000 });
    expect(result.status).toBe("fail");
  });
});
