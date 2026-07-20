import { describe, expect, it } from "vitest";
import {
  parseCostLogLines,
  parseCostSampleLines,
  parseTurnBoundaryLines,
} from "./parse-premium.js";

function turnIndexedSample(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: "session-1",
    timestamp: "2026-07-03T04:46:03.000Z",
    cost_delta_usd: 0.139625,
    cumulative_cost_usd: 6.682556,
    api_duration_ms: 7606,
    context_pct: 9,
    lines_added: 3,
    lines_removed: 1,
    cache_read_tokens: 89165,
    cache_write_tokens: 1662,
    turn: 43,
    ...overrides,
  });
}

function epochIndexedSample(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: "session-1",
    timestamp: "2026-07-03T04:47:01.000Z",
    cost_delta_usd: 0.02,
    cumulative_cost_usd: 6.7,
    api_duration_ms: 3200,
    context_pct: 12,
    lines_added: 0,
    lines_removed: 0,
    cache_read_tokens: 500,
    cache_write_tokens: 10,
    epoch: 1783057922,
    sample: 64,
    ...overrides,
  });
}

describe("parseCostSampleLines (C)", () => {
  it("parses the turn-indexed variant", () => {
    const { samples, malformedCount } = parseCostSampleLines([turnIndexedSample()]);
    expect(malformedCount).toBe(0);
    expect(samples).toHaveLength(1);
    const s = samples[0]!;
    expect(s.sessionId).toBe("session-1");
    expect(s.costDeltaUsd).toBeCloseTo(0.139625);
    expect(s.apiDurationMs).toBe(7606);
    expect(s.contextPct).toBe(9);
    expect(s.linesAdded).toBe(3);
    expect(s.turn).toBe(43);
    expect(s.epoch).toBeUndefined();
    expect(s.sample).toBeUndefined();
  });

  it("parses the epoch-indexed variant", () => {
    const { samples } = parseCostSampleLines([epochIndexedSample()]);
    const s = samples[0]!;
    expect(s.epoch).toBe(1783057922);
    expect(s.sample).toBe(64);
    expect(s.turn).toBeUndefined();
  });

  it("handles both variants co-occurring (version switchover)", () => {
    const { samples, malformedCount } = parseCostSampleLines([
      turnIndexedSample(),
      epochIndexedSample(),
    ]);
    expect(malformedCount).toBe(0);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.turn).toBe(43);
    expect(samples[1]!.sample).toBe(64);
  });

  it("counts malformed lines and never throws", () => {
    const { samples, malformedCount } = parseCostSampleLines([
      turnIndexedSample(),
      "{ not json",
      "[1,2,3]", // valid JSON, wrong shape (array, not object)
      JSON.stringify({ timestamp: "x", cost_delta_usd: 1 }), // missing session_id
      "", // blank -> skipped, not malformed
      epochIndexedSample(),
    ]);
    expect(samples).toHaveLength(2);
    expect(malformedCount).toBe(3);
  });

  it("coerces missing numeric fields to 0 rather than dropping the line", () => {
    const { samples, malformedCount } = parseCostSampleLines([
      JSON.stringify({ session_id: "s", timestamp: "2026-07-03T00:00:00.000Z" }),
    ]);
    expect(malformedCount).toBe(0);
    expect(samples[0]!.costDeltaUsd).toBe(0);
    expect(samples[0]!.apiDurationMs).toBe(0);
  });
});

describe("parseTurnBoundaryLines (B)", () => {
  it("parses a boundary line", () => {
    const { boundaries, malformedCount } = parseTurnBoundaryLines([
      JSON.stringify({
        session_id: "session-1",
        transcript_path: "/x/session-1.jsonl",
        turn_end: "2026-07-03T05:54:53.000Z",
        turn_end_epoch: 1783058093,
      }),
    ]);
    expect(malformedCount).toBe(0);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]!.turnEnd).toBe("2026-07-03T05:54:53.000Z");
    expect(boundaries[0]!.turnEndEpoch).toBe(1783058093);
  });

  it("marks a session_id-less boundary malformed", () => {
    const { boundaries, malformedCount } = parseTurnBoundaryLines([
      JSON.stringify({ turn_end: "2026-07-03T05:54:53.000Z" }),
    ]);
    expect(boundaries).toHaveLength(0);
    expect(malformedCount).toBe(1);
  });
});

describe("parseCostLogLines (L)", () => {
  it("parses per-session total rows", () => {
    const { rows, malformedCount } = parseCostLogLines([
      JSON.stringify({
        session_id: "session-1",
        timestamp: "2026-06-26T23:39:54.000Z",
        cost_usd: 1.8167906,
        duration_ms: 3521047,
        model: "Sonnet 4.6",
        dir: "/personal/project",
        context_pct: 45,
        cache_read: 3283204,
        cache_write: 85929,
        lines_added: 16,
        lines_removed: 16,
      }),
      JSON.stringify({ session_id: "session-2", cost_usd: 0.5 }),
    ]);
    expect(malformedCount).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.costUsd).toBeCloseTo(1.8167906);
    expect(rows[0]!.model).toBe("Sonnet 4.6");
    expect(rows[1]!.sessionId).toBe("session-2");
    expect(rows[1]!.costUsd).toBe(0.5);
  });
});
