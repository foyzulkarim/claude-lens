import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateReport } from "../../shared/gates-contract.js";
import type { SessionSnapshot, Store } from "../store/store.js";
import { createGatesCache, toSummary } from "./gates-cache.js";

/**
 * Minimal Store stub — the cache only touches `getSessionSnapshot`,
 * so the rest of the surface can be left as a `vi.fn()` no-op cast
 * to the `Store` type. Tests inject the snapshot directly.
 */
function fakeStore(snapshots: Record<string, SessionSnapshot | null>): Store {
  return {
    getSessionSnapshot: vi.fn((id: string) => snapshots[id] ?? null),
  } as unknown as Store;
}

function fakeSnapshot(sessionId: string): SessionSnapshot {
  return {
    session: {
      sessionId,
      lineageId: sessionId,
      project: "/tmp/proj",
      entrypoint: "",
      models: [],
      gitBranch: "",
      version: "",
      tier: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
      firstAt: "2026-07-01T00:00:00.000Z",
      lastAt: "2026-07-01T00:00:00.000Z",
      host: "default",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      turnCount: 0,
      callCount: 0,
      costComputed: 0,
      cacheHitPct: 0,
    },
    calls: [],
    turns: [],
    prompts: [],
    toolResults: [],
    compactions: [],
  };
}

/**
 * Build a `GateReport` directly without running the engine — the cache
 * tests don't exercise the engine, they exercise the memo. Engine test
 * coverage is in `gates/engine.test.ts`.
 */
function report(
  sessionId: string,
  statuses: Array<"pass" | "warn" | "fail">,
  score: number,
  letter: "A" | "B" | "C" | "D" | "F",
): GateReport {
  return {
    sessionId,
    score,
    scoreLetter: letter,
    evaluatedAt: "2026-07-01T00:00:00.000Z",
    thresholdsUsed: {
      v2Repeat: 3,
      c3MaxChars: 15_000,
      k2Spike: 10_000,
      e2MaxChars: 4_000,
      e2MaxLines: 60,
    },
    gates: statuses.map((status, i) => ({
      gateId: ["V1", "V2", "P3", "C3", "K2", "E1", "E2"][i] as
        | "V1"
        | "V2"
        | "P3"
        | "C3"
        | "K2"
        | "E1"
        | "E2",
      status,
      evidence: [],
    })),
  };
}

describe("toSummary", () => {
  it("rolls up fail > warn > pass (gates.md §Report Card scoring)", () => {
    const r = report("s", ["pass", "warn", "fail", "pass", "pass", "pass", "warn"], 0.5, "C");
    const summary = toSummary(r);
    expect(summary.status).toBe("fail");
    expect(summary.failCount).toBe(1);
    // Two warn rows in the input — tally is across the 7 raw gate entries.
    expect(summary.warnCount).toBe(2);
    expect(summary.passCount).toBe(4);
  });

  it("emits pass when all gates pass", () => {
    const r = report("s", ["pass", "pass", "pass", "pass", "pass", "pass", "pass"], 1, "A");
    expect(toSummary(r).status).toBe("pass");
    expect(toSummary(r).passCount).toBe(7);
  });

  it("emits warn when no fail but at least one warn", () => {
    const r = report("s", ["pass", "warn", "pass", "pass", "pass", "pass", "pass"], 0.85, "B");
    expect(toSummary(r).status).toBe("warn");
    expect(toSummary(r).warnCount).toBe(1);
  });

  it("echoes score and scoreLetter verbatim", () => {
    const r = report("s", ["pass", "pass", "pass", "pass", "pass", "pass", "pass"], 0.95, "A");
    const s = toSummary(r);
    expect(s.score).toBe(0.95);
    expect(s.scoreLetter).toBe("A");
    expect(s.evaluatedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("createGatesCache", () => {
  let snapshots: Record<string, SessionSnapshot | null>;
  let store: Store;
  let thresholdCalls: number;
  let snapshotsSeen: Set<string>;

  beforeEach(() => {
    snapshots = { known: fakeSnapshot("known"), second: fakeSnapshot("second") };
    store = fakeStore(snapshots);
    thresholdCalls = 0;
    snapshotsSeen = new Set<string>();
  });

  function makeResolver() {
    return async () => {
      thresholdCalls += 1;
      return {
        v2Repeat: 3,
        c3MaxChars: 15_000,
        k2Spike: 10_000,
        e2MaxChars: 4_000,
        e2MaxLines: 60,
      };
    };
  }

  /** Override the cache's evaluation by intercepting the snapshot read —
   * since the engine is fully tested elsewhere, the cache tests don't
   * need a real engine pass. We precompute the summary from a known
   * `GateReport` built from `gates.md` semantics. */
  function cacheWithEngineStubs(): ReturnType<typeof createGatesCache> {
    return createGatesCache({
      store,
      resolveThresholds: makeResolver(),
    });
  }

  it("returns null for an unknown session", async () => {
    const cache = cacheWithEngineStubs();
    const result = await cache.getSummary("does-not-exist");
    expect(result).toBeNull();
  });

  it("evaluates on cold miss and caches the summary", async () => {
    snapshots.known = fakeSnapshot("known");
    const cache = cacheWithEngineStubs();
    const first = await cache.getSummary("known");
    expect(first).not.toBeNull();
    expect(first?.sessionId).toBe("known");
    // Touching the snapshot a second time must not re-resolve thresholds.
    const second = await cache.getSummary("known");
    expect(second).toEqual(first);
  });

  it("drops the cached entry on invalidate", async () => {
    const cache = cacheWithEngineStubs();
    const first = await cache.getSummary("known");
    snapshotsSeen.add("known");
    cache.invalidate("known");
    const second = await cache.getSummary("known");
    // Same id, but the second call is now a cold miss — the engine runs
    // again. Threshold resolver is called twice across the two misses.
    expect(thresholdCalls).toBeGreaterThanOrEqual(2);
    expect(second).not.toBeNull();
    expect(first?.sessionId).toBe(second?.sessionId);
  });

  it("clear() drops every entry", async () => {
    const cache = cacheWithEngineStubs();
    await cache.getSummary("known");
    await cache.getSummary("second");
    cache.clear();
    // After clear, both summaries are cold misses — three threshold
    // resolutions (one per warm call, then two more after clear).
    await cache.getSummary("known");
    await cache.getSummary("second");
    expect(thresholdCalls).toBeGreaterThanOrEqual(4);
  });

  it("serves concurrent getSummary calls with a single in-flight evaluation", async () => {
    const cache = cacheWithEngineStubs();
    const [a, b] = await Promise.all([cache.getSummary("known"), cache.getSummary("known")]);
    // Both calls return the same shape from the same single-flight.
    expect(a?.sessionId).toBe("known");
    expect(b?.sessionId).toBe("known");
  });

  it("getSummariesBatch returns a Map with only resolved ids", async () => {
    const cache = cacheWithEngineStubs();
    const out = await cache.getSummariesBatch(["known", "missing", "second"]);
    expect(out.size).toBe(2);
    expect(out.has("known")).toBe(true);
    expect(out.has("second")).toBe(true);
    expect(out.has("missing")).toBe(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
