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

  // 🟠 T2 — pin the documented coerce-not-drop decision (parse-premium.ts:97-110):
  // a numeric field arriving as a string yields 0 via toNum, so the sample
  // survives into `samples`. A future tightening of toNum to drop the line
  // instead of coercing would silently break that contract.
  it("coerces string-typed numeric fields to 0 rather than dropping the line", () => {
    const { samples, malformedCount } = parseCostSampleLines([
      turnIndexedSample({ cost_delta_usd: "0.42" }),
    ]);
    expect(malformedCount).toBe(0);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.costDeltaUsd).toBe(0);
  });

  // 🟠 T2 (counterpart) — toStr yields "" for a non-string `session_id`, and
  // parsePremiumLine's guard then drops the record and counts it malformed.
  // The session_id is empty *after* the build step; we observe that via the
  // public surface (record never reaches `samples`, `malformedCount++`).
  it("marks a numeric (non-string) session_id as malformed via toStr= '' + sessionId guard", () => {
    const { samples, malformedCount } = parseCostSampleLines([
      turnIndexedSample({ session_id: 12345 }),
    ]);
    expect(samples).toHaveLength(0);
    expect(malformedCount).toBe(1);
  });

  // 🟠 H6 — positive case: every record's session_id matches the expected
  // sessionId, so all survive into `samples`.
  it("accepts every record whose session_id matches the expected one", () => {
    const { samples, malformedCount } = parseCostSampleLines(
      [
        turnIndexedSample({ session_id: "session-A", turn: 43 }),
        turnIndexedSample({ session_id: "session-A", turn: 44 }),
      ],
      "session-A",
    );
    expect(malformedCount).toBe(0);
    expect(samples).toHaveLength(2);
    expect(samples.every((s) => s.sessionId === "session-A")).toBe(true);
  });

  // 🟠 H6 — negative case: a record whose session_id does NOT match is
  // counted as malformed and dropped, so it cannot silently contribute
  // observed values to the wrong session.
  it("counts mismatched session_id as malformed and drops the record", () => {
    const { samples, malformedCount } = parseCostSampleLines(
      [
        turnIndexedSample({ session_id: "session-A" }),
        turnIndexedSample({ session_id: "session-B", turn: 44 }),
      ],
      "session-A",
    );
    expect(malformedCount).toBe(1);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.sessionId).toBe("session-A");
  });

  // 🟠 H6 — control case: when expectedSessionId is omitted, every record
  // is accepted regardless of its session_id (L's "route by own ID"
  // semantics survive as the no-arg overload).
  it("accepts records with mixed session_ids when expectedSessionId is omitted", () => {
    const { samples, malformedCount } = parseCostSampleLines([
      turnIndexedSample({ session_id: "session-A" }),
      turnIndexedSample({ session_id: "session-B", turn: 44 }),
    ]);
    expect(malformedCount).toBe(0);
    expect(samples).toHaveLength(2);
  });

  // 🟡 M4 — a string field over LOCAL_STORE_STRING_MAX is treated as
  // malformed (security #3). Without the cap a one-row sessionId of 1 MB
  // would broadcast a 1 MB WS frame to every connected client.
  it("treats an over-long string field as malformed", () => {
    const overLong = "x".repeat(201); // 1 char over LOCAL_STORE_STRING_MAX = 200
    const { samples, malformedCount } = parseCostSampleLines([
      turnIndexedSample({ timestamp: overLong }),
      turnIndexedSample({ session_id: overLong }),
      turnIndexedSample(), // a clean baseline line
    ]);
    expect(malformedCount).toBe(2);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.sessionId).toBe("session-1");
  });

  // 💭 Security #5 — a pathologically nested JSON payload is rejected
  // before JSON.parse. We build a single object whose `{` + `[` char count
  // exceeds the depth-guard threshold (64).
  it("treats a deeply nested JSON payload as malformed before JSON.parse", () => {
    const nested: Record<string, unknown> = { a: { b: { c: { d: { e: 1 } } } } };
    let expanded: Record<string, unknown> = nested;
    for (let i = 0; i < 30; i++) {
      expanded = { next: expanded };
    }
    const { samples, malformedCount } = parseCostSampleLines([JSON.stringify(expanded)]);
    expect(malformedCount).toBe(1);
    expect(samples).toHaveLength(0);
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

  // 🟠 H6 — same expectedSessionId discipline as the C parser.
  it("accepts boundaries whose session_id matches the expected one", () => {
    const { boundaries, malformedCount } = parseTurnBoundaryLines(
      [
        JSON.stringify({
          session_id: "session-A",
          transcript_path: "/x/session-A.jsonl",
          turn_end: "2026-07-03T05:54:53.000Z",
          turn_end_epoch: 1783058093,
        }),
      ],
      "session-A",
    );
    expect(malformedCount).toBe(0);
    expect(boundaries).toHaveLength(1);
  });

  it("counts mismatched session_id as malformed for turn boundaries", () => {
    const { boundaries, malformedCount } = parseTurnBoundaryLines(
      [
        JSON.stringify({
          session_id: "session-B",
          transcript_path: "/x/session-B.jsonl",
          turn_end: "2026-07-03T05:54:53.000Z",
          turn_end_epoch: 1783058093,
        }),
      ],
      "session-A",
    );
    expect(malformedCount).toBe(1);
    expect(boundaries).toHaveLength(0);
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

  // M15 (review): parseCostLogLines never throws on malformed input —
  // malformed lines are counted but the function returns a clean rows
  // array. Companion to the C/B malformed tests.
  it("counts malformed lines and never throws (M15)", () => {
    const validRow = JSON.stringify({
      session_id: "session-1",
      timestamp: "2026-07-21T10:00:00.000Z",
      cost_usd: 0.5,
      duration_ms: 1000,
      model: "Sonnet 4.6",
      dir: "/x",
      context_pct: 30,
      cache_read: 0,
      cache_write: 0,
      lines_added: 5,
      lines_removed: 2,
    });
    const { rows, malformedCount } = parseCostLogLines([
      "", // empty → skipped, not malformed
      "{ this is not valid json", // JSON parse fail → malformed
      "[]", // not an object → malformed
      validRow,
      JSON.stringify({ cost_usd: 1.0 }), // missing sessionId → malformed (sessionId guard)
      "null", // not an object → malformed
    ]);
    expect(malformedCount).toBe(4);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe("session-1");
  });
});
