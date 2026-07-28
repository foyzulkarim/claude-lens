import { describe, expect, it } from "vitest";
import type {
  CacheCreationEntry,
  CacheScorecardCore,
  CacheScorecardCoreWithMeta,
  ScorecardSessionMeta,
  ScorecardThresholds,
  WasteEventKind,
} from "../../shared/scorecard-contract.js";
import type { PricingTable } from "../metrics/measures.js";
import { applyGrade, priceWasteEntry, resolveBands, selectBiggestLever } from "./fleet.js";

const THRESHOLDS: ScorecardThresholds = {
  floorCalls: 10,
  calibrationMinSessions: 20,
  A: 95,
  B: 85,
  C: 70,
  D: 50,
};

function meta(overrides: Partial<ScorecardSessionMeta> = {}): ScorecardSessionMeta {
  return {
    sessionId: "s1",
    project: "/synthetic/project",
    models: ["claude-sonnet-5"],
    branch: "main",
    host: "host-1",
    ...overrides,
  };
}

function entry(overrides: Partial<CacheCreationEntry> = {}): CacheCreationEntry {
  return {
    eventId: "m1",
    callId: "m1",
    promptId: "prompt-1",
    turnNumber: 1,
    timestamp: "2026-07-01T00:00:00.000Z",
    model: "claude-sonnet-5",
    project: "/synthetic/project",
    branch: "main",
    warmupTokens: 0,
    incrementalTokens: 0,
    rewrittenTokens: 0,
    baseCause: "unexplained",
    attribution: "unknown",
    kind: null,
    ...overrides,
  };
}

function wasteEntry(
  overrides: Partial<CacheCreationEntry> & { kind: WasteEventKind },
): CacheCreationEntry & { kind: WasteEventKind } {
  return entry(overrides) as CacheCreationEntry & { kind: WasteEventKind };
}

function core(overrides: Partial<CacheScorecardCore> = {}, score = 1): CacheScorecardCore {
  return {
    sessionId: "s1",
    mainThreadCalls: 20,
    cacheReadTokens: 0,
    writes: [],
    decomposition: { warmup: 100, incremental: 0, rewritten: 0 },
    wasteRatio: 0,
    hitRatio: 0,
    scoreInputs: { confirmedFixableWaste: 0, scoreableCreation: 100 },
    hygieneScore: score,
    ...overrides,
  };
}

function withMeta(
  base: CacheScorecardCore,
  metaOverrides: Partial<ScorecardSessionMeta> = {},
): CacheScorecardCoreWithMeta {
  return { ...base, sessionMeta: meta({ sessionId: base.sessionId, ...metaOverrides }) };
}

const PRICING: PricingTable = {
  "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
};

describe("resolveBands", () => {
  it("returns fixed bands below the calibration minimum", () => {
    const bands = resolveBands([0.9, 0.5], THRESHOLDS);
    expect(bands).toEqual({ A: 95, B: 85, C: 70, D: 50, source: "fixed" });
  });

  it("returns nearest-rank p80/p60/p40/p20 bands at or above the calibration minimum", () => {
    const scores = Array.from({ length: 20 }, (_, i) => (i + 1) / 20); // 0.05..1.00
    const bands = resolveBands(scores, THRESHOLDS);
    expect(bands.source).toBe("calibrated");
    // nearest-rank(80) over 20 ascending values 5..100 step 5 -> rank ceil(16)=16 -> value 80
    expect(bands).toEqual({ A: 80, B: 60, C: 40, D: 20, source: "calibrated" });
  });

  it("does not grade a similar fleet all F and lets a healthy long session earn A/B", () => {
    const mediocre = Array.from({ length: 20 }, () => 0.6);
    const scores = [...mediocre, 0.95];
    const bands = resolveBands(scores, THRESHOLDS);

    const mediocreGrade = applyGrade(core({}, 0.6), bands, THRESHOLDS);
    const healthyGrade = applyGrade(core({}, 0.95), bands, THRESHOLDS);

    expect(mediocreGrade.state).toBe("graded");
    if (mediocreGrade.state === "graded") expect(mediocreGrade.grade).not.toBe("F");
    expect(healthyGrade.state).toBe("graded");
    if (healthyGrade.state === "graded") expect(["A", "B"]).toContain(healthyGrade.grade);
  });
});

describe("applyGrade", () => {
  const fixedBands = resolveBands([], THRESHOLDS);

  it("returns no-main-thread-calls for a session with zero main-thread calls", () => {
    const result = applyGrade(
      core({ mainThreadCalls: 0, hygieneScore: null }),
      fixedBands,
      THRESHOLDS,
    );
    expect(result).toEqual({ state: "no-main-thread-calls" });
  });

  it("returns too-short below the configured floor", () => {
    const result = applyGrade(core({ mainThreadCalls: 9 }), fixedBands, THRESHOLDS);
    expect(result).toEqual({ state: "too-short", mainThreadCalls: 9, floorCalls: 10 });
  });

  it("returns no-scoreable-creation when hygieneScore is null", () => {
    const result = applyGrade(
      core({ mainThreadCalls: 11, hygieneScore: null }),
      fixedBands,
      THRESHOLDS,
    );
    expect(result).toEqual({ state: "no-scoreable-creation" });
  });

  it("returns a graded state for a gradeable session on fixed bands", () => {
    const result = applyGrade(core({ mainThreadCalls: 11 }, 0.97), fixedBands, THRESHOLDS);
    expect(result).toEqual({ state: "graded", grade: "A", hygieneScore: 0.97, bands: fixedBands });
  });

  it("caps calibrated uplift at one letter and never lowers the fixed grade", () => {
    // All 20 gradeable scores identical at 0.6 -> percentile bands collapse to 60 for A/B/C/D,
    // so the calibrated bucket would jump straight to "A"; the cap holds it to fixed("D") + 1 = "C".
    const bands = resolveBands(
      Array.from({ length: 20 }, () => 0.6),
      THRESHOLDS,
    );
    const result = applyGrade(core({ mainThreadCalls: 11 }, 0.6), bands, THRESHOLDS);
    expect(result.state).toBe("graded");
    if (result.state === "graded") expect(result.grade).toBe("C");
  });

  it("never lowers the fixed grade even when calibrated bands would bucket it worse (#124 review finding #10)", () => {
    // All 20 gradeable scores identical at 0.99 -> percentile bands collapse
    // to 99 for A/B/C/D. A 0.90 session is fixed-graded "B" (>= fixed B:85),
    // but bucketed against all-99 calibrated bands it falls through to "F"
    // (90 < 99 everywhere). The cap must hold the result at the fixed grade,
    // never let a high-performing calibration fleet drag another session's
    // grade down.
    const bands = resolveBands(
      Array.from({ length: 20 }, () => 0.99),
      THRESHOLDS,
    );
    expect(bands).toEqual({ A: 99, B: 99, C: 99, D: 99, source: "calibrated" });
    const result = applyGrade(core({ mainThreadCalls: 11 }, 0.9), bands, THRESHOLDS);
    expect(result.state).toBe("graded");
    if (result.state === "graded") expect(result.grade).toBe("B");
  });
});

describe("priceWasteEntry", () => {
  it("prices the incremental loss vs. a hit with a computed basis", () => {
    const view = priceWasteEntry(
      wasteEntry({ rewrittenTokens: 1_000_000, kind: "prefix-bust" }),
      "s1",
      PRICING,
    );
    expect(view.costEstimate).toBeCloseTo(3.75 - 0.3, 5);
    expect(view.costBasis).toBe("computed");
  });

  it("returns null (never $0) and unavailable basis when the model is unpriced", () => {
    const view = priceWasteEntry(
      wasteEntry({ model: "unpriced-model", rewrittenTokens: 1_000_000, kind: "prefix-bust" }),
      "s1",
      {},
    );
    expect(view.costEstimate).toBeNull();
    expect(view.costBasis).toBe("unavailable");
  });

  it("deep-links to the turn when resolvable, else the session scorecard anchor", () => {
    const withTurn = priceWasteEntry(
      wasteEntry({ turnNumber: 4, kind: "prefix-bust" }),
      "s1",
      PRICING,
    );
    expect(withTurn.deepLink).toBe("/session/s1/turn/4");

    const withoutTurn = priceWasteEntry(
      wasteEntry({ turnNumber: null, kind: "prefix-bust" }),
      "s1",
      PRICING,
    );
    expect(withoutTurn.deepLink).toBe("/sessions/s1#cache-scorecard");
  });
});

describe("selectBiggestLever", () => {
  const range = { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" };

  it("ranks the max in-range event by tokensRewritten within filters", () => {
    const small = withMeta(
      core({
        sessionId: "s-small",
        writes: [
          entry({
            eventId: "e-small",
            timestamp: "2026-07-01T01:00:00.000Z",
            rewrittenTokens: 500,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s-small" },
    );
    const big = withMeta(
      core({
        sessionId: "s-big",
        writes: [
          entry({
            eventId: "e-big",
            timestamp: "2026-07-01T02:00:00.000Z",
            rewrittenTokens: 5000,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s-big" },
    );

    const result = selectBiggestLever([small, big], range, {}, PRICING);
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.eventId).toBe("e-big");
  });

  it("deep-links to the session's scorecard section, never Turn Inspector, even when the winning event's turn resolves (R7)", () => {
    const withResolvableTurn = withMeta(
      core({
        sessionId: "s-turn",
        writes: [
          entry({
            eventId: "e-turn",
            turnNumber: 4,
            timestamp: "2026-07-01T01:00:00.000Z",
            rewrittenTokens: 500,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s-turn" },
    );

    const result = selectBiggestLever([withResolvableTurn], range, {}, PRICING);
    expect(result.state).toBe("event");
    if (result.state === "event") {
      expect(result.deepLink).toBe("/sessions/s-turn#cache-scorecard");
    }
  });

  it("resolves ties by timestamp desc, then sessionId asc, then callId asc", () => {
    const a = withMeta(
      core({
        sessionId: "s-a",
        writes: [
          entry({
            eventId: "tied",
            callId: "call-a",
            timestamp: "2026-07-01T03:00:00.000Z",
            rewrittenTokens: 1000,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s-a" },
    );
    const b = withMeta(
      core({
        sessionId: "s-b",
        writes: [
          entry({
            eventId: "tied",
            callId: "call-b",
            timestamp: "2026-07-01T03:00:00.000Z",
            rewrittenTokens: 1000,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s-b" },
    );

    const result = selectBiggestLever([b, a], range, {}, PRICING);
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.sessionId).toBe("s-a");
  });

  it("excludes events outside the range and filters by project/model/branch/host", () => {
    const outOfRange = withMeta(
      core({
        sessionId: "s1",
        writes: [
          entry({
            timestamp: "2026-06-30T00:00:00.000Z",
            rewrittenTokens: 9999,
            kind: "prefix-bust",
          }),
        ],
      }),
    );
    const wrongProject = withMeta(
      core({
        sessionId: "s2",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            project: "/other/project",
            rewrittenTokens: 9999,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s2" },
    );
    const inScope = withMeta(
      core({
        sessionId: "s3",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            rewrittenTokens: 42,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s3" },
    );

    const result = selectBiggestLever(
      [outOfRange, wrongProject, inScope],
      range,
      { project: ["/synthetic/project"] },
      PRICING,
    );
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.tokensRewritten).toBe(42);
  });

  it("excludes an event whose model does not match the model filter (#124 review finding #11)", () => {
    const wrongModel = withMeta(
      core({
        sessionId: "s1",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            model: "claude-opus-5",
            rewrittenTokens: 9999,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s1" },
    );
    const inScope = withMeta(
      core({
        sessionId: "s2",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            model: "claude-sonnet-5",
            rewrittenTokens: 42,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s2" },
    );

    const result = selectBiggestLever(
      [wrongModel, inScope],
      range,
      { model: ["claude-sonnet-5"] },
      PRICING,
    );
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.tokensRewritten).toBe(42);
  });

  it("excludes an event whose branch does not match the branch filter (#124 review finding #11)", () => {
    const wrongBranch = withMeta(
      core({
        sessionId: "s1",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            branch: "feature/other",
            rewrittenTokens: 9999,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s1" },
    );
    const inScope = withMeta(
      core({
        sessionId: "s2",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            branch: "main",
            rewrittenTokens: 42,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s2" },
    );

    const result = selectBiggestLever([wrongBranch, inScope], range, { branch: ["main"] }, PRICING);
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.tokensRewritten).toBe(42);
  });

  it("excludes an event whose session host does not match the host filter (#124 review finding #11)", () => {
    const wrongHost = withMeta(
      core({
        sessionId: "s1",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            rewrittenTokens: 9999,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s1", host: "other-host" },
    );
    const inScope = withMeta(
      core({
        sessionId: "s2",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            rewrittenTokens: 42,
            kind: "prefix-bust",
          }),
        ],
      }),
      { sessionId: "s2", host: "host-1" },
    );

    const result = selectBiggestLever([wrongHost, inScope], range, { host: ["host-1"] }, PRICING);
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.tokensRewritten).toBe(42);
  });

  it("carries a presentation-ready kind the client never reconstructs", () => {
    const idle = withMeta(
      core({
        sessionId: "s1",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            attribution: "ttl-lapse",
            rewrittenTokens: 100,
            kind: "idle-expiry",
          }),
        ],
      }),
    );
    const result = selectBiggestLever([idle], range, {}, PRICING);
    expect(result.state).toBe("event");
    if (result.state === "event") expect(result.kind).toBe("idle-expiry");
  });

  it("returns the healthy variant with a real first-write share when the period has creation but no waste", () => {
    const healthy = withMeta(
      core({
        sessionId: "s1",
        writes: [
          entry({
            timestamp: "2026-07-01T01:00:00.000Z",
            warmupTokens: 300,
            incrementalTokens: 200,
            rewrittenTokens: 0,
            kind: null,
          }),
        ],
      }),
    );
    const result = selectBiggestLever([healthy], range, {}, PRICING);
    expect(result).toEqual({
      state: "healthy",
      firstWriteTokens: 500,
      totalCreationTokens: 500,
      firstWriteShare: 1,
    });
  });

  it("returns the no-cache-activity variant with a null share when the period has zero creation", () => {
    const idle = withMeta(core({ sessionId: "s1", writes: [] }));
    const result = selectBiggestLever([idle], range, {}, PRICING);
    expect(result).toEqual({
      state: "no-cache-activity",
      firstWriteTokens: 0,
      totalCreationTokens: 0,
      firstWriteShare: null,
    });
  });
});
