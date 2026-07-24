import { describe, expect, it } from "vitest";
import type { ScatterMetricsQuery, ScatterPoint } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { newQueryProbe } from "../observability.js";
import type { MetricsInput } from "./engine.js";
import { DEFAULT_PRICING_TABLE } from "./measures.js";
import {
  computeRegression,
  metricsScatter,
  SCATTER_VISUAL_CAP,
  samplePointsDeterministically,
} from "./scatter.js";

function iso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: "s1",
    lineageId: "s1",
    project: "/repo/alpha",
    entrypoint: "cli",
    models: ["claude-sonnet-5"],
    gitBranch: "main",
    version: "1.2.3",
    host: "default",
    tier: {
      hasCostSamples: false,
      hasTurnBoundaries: false,
      hasCostLog: false,
      costBasis: "computed",
    },
    firstAt: iso(2026, 6, 13, 10, 0),
    lastAt: iso(2026, 6, 13, 10, 5),
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    turnCount: 0,
    callCount: 0,
    costComputed: 0,
    cacheHitPct: 0,
    ...overrides,
  };
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: iso(2026, 6, 13, 10, 0),
    model: "claude-sonnet-5",
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function baseQuery(overrides: Partial<ScatterMetricsQuery> = {}): ScatterMetricsQuery {
  return {
    mode: "scatter",
    entity: "session",
    measures: ["costComputed"],
    dimensions: [],
    grain: "day",
    range: { from: iso(2026, 6, 13, 0, 0), to: iso(2026, 6, 15, 23, 59) },
    xMeasure: "costComputed",
    yMeasure: "wallMinutes",
    sessionPopulation: {},
    ...overrides,
  };
}

describe("computeRegression — pure OLS helper", () => {
  it("matches hand-computed slope, intercept, and R²", () => {
    // Y = 2X + 1 — slope=2, intercept=1, R²=1.
    const points: ScatterPoint[] = [
      { sessionId: "a", x: 1, y: 3 },
      { sessionId: "b", x: 2, y: 5 },
      { sessionId: "c", x: 3, y: 7 },
      { sessionId: "d", x: 4, y: 9 },
    ];
    const result = computeRegression(points);
    expect(result).not.toBeNull();
    expect(result?.slope).toBeCloseTo(2, 10);
    expect(result?.intercept).toBeCloseTo(1, 10);
    expect(result?.rSquared).toBeCloseTo(1, 10);
  });

  it("returns null for fewer than two usable points", () => {
    expect(computeRegression([])).toBeNull();
    expect(computeRegression([{ sessionId: "a", x: 1, y: 1 }])).toBeNull();
  });

  it("returns null when all X values are identical (variance=0)", () => {
    const points: ScatterPoint[] = [
      { sessionId: "a", x: 5, y: 1 },
      { sessionId: "b", x: 5, y: 2 },
      { sessionId: "c", x: 5, y: 3 },
    ];
    expect(computeRegression(points)).toBeNull();
  });

  it("produces finite numbers on a noisy data set", () => {
    const points: ScatterPoint[] = [
      { sessionId: "a", x: 1, y: 0.9 },
      { sessionId: "b", x: 2, y: 2.1 },
      { sessionId: "c", x: 3, y: 2.9 },
      { sessionId: "d", x: 4, y: 4.1 },
    ];
    const result = computeRegression(points);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result?.slope ?? NaN)).toBe(true);
    expect(Number.isFinite(result?.intercept ?? NaN)).toBe(true);
    expect(result?.rSquared).toBeGreaterThan(0.9);
    expect(result?.rSquared).toBeLessThanOrEqual(1);
  });
});

describe("samplePointsDeterministically — visual-point cap (R11, A5)", () => {
  it("returns all points when at or under the cap", () => {
    const points: ScatterPoint[] = Array.from({ length: 50 }, (_, i) => ({
      sessionId: `s${i}`,
      x: i,
      y: i,
    }));
    const result = samplePointsDeterministically(points);
    expect(result).toHaveLength(50);
  });

  it("caps at SCATTER_VISUAL_CAP (500) when eligible is larger", () => {
    const points: ScatterPoint[] = Array.from({ length: 5000 }, (_, i) => ({
      sessionId: `s${i}`,
      x: Math.random(),
      y: i,
    }));
    const result = samplePointsDeterministically(points);
    expect(result.length).toBeLessThanOrEqual(SCATTER_VISUAL_CAP);
  });

  it("preserves outliers (top/bottom by Y) regardless of seed", () => {
    // Force known extremes — sessionId-keyed distribution would miss
    // these without the head/tail preservation step.
    const points: ScatterPoint[] = Array.from({ length: 2000 }, (_, i) => ({
      sessionId: `s${String(i).padStart(4, "0")}`,
      x: i,
      y: i, // top Y = s1999, bottom Y = s0000
    }));
    const result = samplePointsDeterministically(points);
    const yValues = result.map((p) => p.y as number).sort((a, b) => a - b);
    expect(yValues[0]).toBe(0); // bottom extreme preserved
    expect(yValues[yValues.length - 1]).toBe(1999); // top extreme preserved
  });

  it("is deterministic — same input produces same output", () => {
    const points: ScatterPoint[] = Array.from({ length: 1000 }, (_, i) => ({
      sessionId: `s${i}`,
      x: i,
      y: Math.sin(i),
    }));
    const a = samplePointsDeterministically(points);
    const b = samplePointsDeterministically(points);
    expect(a).toEqual(b);
  });
});

describe("metricsScatter — full pipeline", () => {
  it("returns the response shape with regression and full-eligible regression", () => {
    const sessions: Session[] = [
      baseSession({ sessionId: "s1", firstAt: iso(2026, 6, 13, 10, 0), costComputed: 0.1 }),
      baseSession({ sessionId: "s2", firstAt: iso(2026, 6, 13, 11, 0), costComputed: 0.2 }),
      baseSession({ sessionId: "s3", firstAt: iso(2026, 6, 13, 12, 0), costComputed: 0.3 }),
    ];
    const calls: ApiCall[] = [
      call({
        sessionId: "s1",
        timestamp: iso(2026, 6, 13, 10, 0),
        usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        sessionId: "s2",
        timestamp: iso(2026, 6, 13, 11, 0),
        usage: { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
      call({
        sessionId: "s3",
        timestamp: iso(2026, 6, 13, 12, 0),
        usage: { inputTokens: 3000, outputTokens: 300, cacheReadTokens: 0, cacheCreateTokens: 0 },
      }),
    ];
    const turns: Turn[] = calls.map((c, i) => ({
      promptId: `p${i}`,
      sessionId: c.sessionId,
      isSidechain: false,
      startedAt: c.timestamp,
      endedAt: iso(2026, 6, 13, 10, Number(i + 1)),
      calls: [c],
      usage: c.usage,
      toolResultBytes: 0,
    }));
    const input: MetricsInput = { calls, turns, sessions, pricing: DEFAULT_PRICING_TABLE };
    const query = baseQuery();

    const result = metricsScatter(input, query);
    expect(result.mode).toBe("scatter");
    expect(result.entity).toBe("session");
    expect(result.xMeasure).toBe("costComputed");
    expect(result.yMeasure).toBe("wallMinutes");
    expect(result.points).toHaveLength(3);
    expect(result.regression).not.toBeNull();
    expect(result.population.matched).toBe(3);
    expect(result.population.eligible).toBe(3);
    expect(result.population.returned).toBe(3);
    expect(result.population.sampled).toBe(false);
  });

  it("applies population criteria (project filter narrows the matched set)", () => {
    const sessions: Session[] = [
      baseSession({
        sessionId: "s-alpha",
        project: "/repo/alpha",
        firstAt: iso(2026, 6, 13, 10, 0),
      }),
      baseSession({ sessionId: "s-beta", project: "/repo/beta", firstAt: iso(2026, 6, 13, 11, 0) }),
    ];
    const calls: ApiCall[] = sessions.map((s, i) =>
      call({
        sessionId: s.sessionId,
        timestamp: s.firstAt,
        usage: {
          inputTokens: 1000 * (i + 1),
          outputTokens: 100 * (i + 1),
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        },
      }),
    );
    const turns: Turn[] = calls.map((c, i) => ({
      promptId: `p${i}`,
      sessionId: c.sessionId,
      isSidechain: false,
      startedAt: c.timestamp,
      endedAt: c.timestamp,
      calls: [c],
      usage: c.usage,
      toolResultBytes: 0,
    }));
    const input: MetricsInput = { calls, turns, sessions, pricing: DEFAULT_PRICING_TABLE };
    const query = baseQuery({ sessionPopulation: { project: ["/repo/alpha"] } });

    const result = metricsScatter(input, query);
    expect(result.population.matched).toBe(1);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.sessionId).toBe("s-alpha");
  });

  it("excludes unavailable measures honestly (costObserved → null → exclusion, no fabrication as 0)", () => {
    // All sessions are transcript-tier — no costObserved parser
    // populates it yet, so all values resolve to null.
    const sessions: Session[] = [
      baseSession({ sessionId: "s1", firstAt: iso(2026, 6, 13, 10, 0) }),
      baseSession({ sessionId: "s2", firstAt: iso(2026, 6, 13, 11, 0) }),
    ];
    const input: MetricsInput = { calls: [], turns: [], sessions, pricing: DEFAULT_PRICING_TABLE };
    const query = baseQuery({ xMeasure: "costObserved", yMeasure: "wallMinutes" });

    const result = metricsScatter(input, query);
    expect(result.population.matched).toBe(2);
    expect(result.population.eligible).toBe(0);
    expect(result.population.excludedMissingMeasures).toBe(2);
    expect(result.points).toEqual([]);
    expect(result.regression).toBeNull();
  });

  it("regenerates a session-scope totalTokens preset from Session.usage", () => {
    const sessions: Session[] = [
      baseSession({
        sessionId: "s1",
        firstAt: iso(2026, 6, 13, 10, 0),
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 25, cacheCreateTokens: 10 },
      }),
      baseSession({
        sessionId: "s2",
        firstAt: iso(2026, 6, 13, 11, 0),
        usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 50, cacheCreateTokens: 20 },
      }),
    ];
    const calls: ApiCall[] = sessions.map((s) =>
      call({
        sessionId: s.sessionId,
        timestamp: s.firstAt,
        usage: s.usage,
      }),
    );
    const turns: Turn[] = calls.map((c, i) => ({
      promptId: `p${i}`,
      sessionId: c.sessionId,
      isSidechain: false,
      startedAt: c.timestamp,
      endedAt: c.timestamp,
      calls: [c],
      usage: c.usage,
      toolResultBytes: 0,
    }));
    const input: MetricsInput = { calls, turns, sessions, pricing: DEFAULT_PRICING_TABLE };
    const query = baseQuery({ xMeasure: "totalTokens", yMeasure: "turns" });

    const result = metricsScatter(input, query);
    // s1 totalTokens = 185, s2 totalTokens = 370. turns = 1 each.
    expect(result.points).toHaveLength(2);
    const xs = result.points.map((p) => p.x).sort((a, b) => (a as number) - (b as number));
    expect(xs[0]).toBe(185);
    expect(xs[1]).toBe(370);
  });
});

describe("metricsScatter — scale cap returns ≤ 500 visible points", () => {
  it("samples to ≤ SCATTER_VISUAL_CAP and reports sampled=true", () => {
    // 1000 sessions all in range — well over the 500-point cap.
    const sessions: Session[] = Array.from({ length: 1000 }, (_, i) =>
      baseSession({
        sessionId: `s${String(i).padStart(4, "0")}`,
        firstAt: iso(2026, 6, 13, 10, i % 60),
        costComputed: i * 0.001,
      }),
    );
    const calls: ApiCall[] = sessions.map((s, i) =>
      call({
        sessionId: s.sessionId,
        timestamp: s.firstAt,
        usage: {
          inputTokens: 100 + i,
          outputTokens: 10 + i,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
        },
      }),
    );
    const turns: Turn[] = calls.map((c, i) => ({
      promptId: `p${i}`,
      sessionId: c.sessionId,
      isSidechain: false,
      startedAt: c.timestamp,
      endedAt: c.timestamp,
      calls: [c],
      usage: c.usage,
      toolResultBytes: 0,
    }));
    const input: MetricsInput = { calls, turns, sessions, pricing: DEFAULT_PRICING_TABLE };
    const query = baseQuery();

    const result = metricsScatter(input, query);
    expect(result.population.matched).toBe(1000);
    expect(result.points.length).toBeLessThanOrEqual(SCATTER_VISUAL_CAP);
    expect(result.population.sampled).toBe(true);
    expect(result.population.returned).toBe(result.points.length);
  });
});

// ---------------------------------------------------------------------------
// ARCH-119 T2/A6: scatter populates the same probe best-effort (groupCount =
// matched scope count; scatter has no time buckets so bucketCount stays 0).
// ---------------------------------------------------------------------------

describe("metricsScatter — probe instrumentation", () => {
  it("populates groupCount from matched scopes and leaves bucketCount at 0", () => {
    const sessions = [
      baseSession({ sessionId: "sa", firstAt: iso(2026, 6, 13, 10, 0) }),
      baseSession({ sessionId: "sb", firstAt: iso(2026, 6, 14, 10, 0) }),
    ];
    const calls = [call({ sessionId: "sa" }), call({ sessionId: "sb" })];
    const input: MetricsInput = { calls, turns: [], sessions, pricing: DEFAULT_PRICING_TABLE };

    const probe = newQueryProbe();
    metricsScatter(input, baseQuery(), probe);

    expect(probe.groupCount).toBe(2);
    expect(probe.bucketCount).toBe(0);
    expect(probe.filterGroupMs).toBeGreaterThanOrEqual(0);
    expect(probe.computeMs).toBeGreaterThanOrEqual(0);
  });
});
