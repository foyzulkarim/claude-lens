import { describe, expect, it } from "vitest";
import {
  detectTurnCostAnomalies,
  InvalidAnomalyFactorError,
  type TurnCostSample,
} from "./anomaly.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a TurnCostSample with a given cost, deterministic IDs. */
function make(sessionId: string, turnId: string, costComputed: number): TurnCostSample {
  return { sessionId, turnId, costComputed };
}

// ---------------------------------------------------------------------------
// Detector semantics
// ---------------------------------------------------------------------------

describe("flags only samples above threshold", () => {
  it("flags exactly the sample that is 5× the median with factor=5", () => {
    // median of [1,2,3,4,5,20] = 3.5; threshold = 3.5 * 5 = 17.5; only 20 > 17.5
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 4),
      make("s1", "t5", 5),
      make("s1", "t6", 20), // above threshold
    ];
    const result = detectTurnCostAnomalies(samples, 5);
    expect(result.baseline).toBe(3.5);
    expect(result.ratio).toBe(17.5);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0]).toMatchObject({ turnId: "t6", costComputed: 20 });
  });

  it("does not flag samples exactly at the threshold", () => {
    // median of [1,2,3,6] = 2.5; threshold = 2.5 * 3 = 7.5; 6 is NOT > 7.5
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 6),
    ];
    const result = detectTurnCostAnomalies(samples, 3);
    expect(result.flagged).toHaveLength(0);
  });

  it("flags multiple samples above threshold", () => {
    // median of [1,2,3,4,5,7,10] = 4; threshold = 4 * 2 = 8; 10 exceeds it
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 4),
      make("s1", "t5", 5),
      make("s1", "t6", 7),
      make("s1", "t7", 10),
    ];
    const result = detectTurnCostAnomalies(samples, 2);
    expect(result.baseline).toBe(4);
    expect(result.ratio).toBe(8);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].costComputed).toBe(10);
    // Ordered worst-first
    expect(result.flagged[0].costComputed).toBeGreaterThanOrEqual(result.flagged[0].costComputed);
  });
});

describe("default factor is 5", () => {
  it("uses factor=5 when called without an explicit factor", () => {
    // median of [1,2,3,16] = 2.5; threshold = 2.5 * 5 = 12.5; 16 > 12.5 → flagged
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 16),
    ];
    const result = detectTurnCostAnomalies(samples);
    expect(result.baseline).toBe(2.5);
    expect(result.ratio).toBe(12.5);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].costComputed).toBe(16);
  });
});

describe("non-positive factor rejected", () => {
  it("throws InvalidAnomalyFactorError for factor=0", () => {
    const samples = [make("s1", "t1", 1), make("s1", "t2", 2)];
    expect(() => detectTurnCostAnomalies(samples, 0)).toThrow(InvalidAnomalyFactorError);
  });

  it("throws InvalidAnomalyFactorError for negative factor", () => {
    const samples = [make("s1", "t1", 1), make("s1", "t2", 2)];
    expect(() => detectTurnCostAnomalies(samples, -1)).toThrow(InvalidAnomalyFactorError);
  });

  it("throws InvalidAnomalyFactorError for non-finite factor", () => {
    const samples = [make("s1", "t1", 1), make("s1", "t2", 2)];
    expect(() => detectTurnCostAnomalies(samples, NaN as unknown as number)).toThrow(
      InvalidAnomalyFactorError,
    );
  });

  it("error instance carries the offending factor", () => {
    const samples = [make("s1", "t1", 1), make("s1", "t2", 2)];
    try {
      detectTurnCostAnomalies(samples, -3);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidAnomalyFactorError);
      expect((err as InvalidAnomalyFactorError).factor).toBe(-3);
    }
  });
});

describe("empty population returns no flags", () => {
  it("returns null baseline, null ratio, empty flagged for []", () => {
    const result = detectTurnCostAnomalies([]);
    expect(result.baseline).toBeNull();
    expect(result.ratio).toBeNull();
    expect(result.flagged).toHaveLength(0);
  });
});

describe("single-sample population returns no flags", () => {
  it("returns null baseline and no flags for a single sample", () => {
    const result = detectTurnCostAnomalies([make("s1", "t1", 42)]);
    expect(result.baseline).toBeNull();
    expect(result.ratio).toBeNull();
    expect(result.flagged).toHaveLength(0);
  });
});

describe("median computation correct", () => {
  it("hand-crafted odd-count: [1, 2, 3] → median 2", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
    ];
    const result = detectTurnCostAnomalies(samples, 1);
    expect(result.baseline).toBe(2);
    // factor=1 → threshold = median = 2; cost > 2 only (strict inequality)
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].costComputed).toBe(3);
  });

  it("hand-crafted even-count: [1, 2, 3, 4] → median 2.5", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 4),
    ];
    const result = detectTurnCostAnomalies(samples, 1);
    expect(result.baseline).toBe(2.5);
    // factor=1 → threshold = median = 2.5; costs > 2.5 → 3 and 4
    expect(result.flagged).toHaveLength(2);
    expect(result.flagged.map((s) => s.costComputed)).toEqual([4, 3]);
  });

  it("hand-crafted even-count: [10, 20, 30, 40] → median 25", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 10),
      make("s1", "t2", 20),
      make("s1", "t3", 30),
      make("s1", "t4", 40),
    ];
    const result = detectTurnCostAnomalies(samples, 1);
    expect(result.baseline).toBe(25);
    expect(result.ratio).toBe(25);
    expect(result.flagged.map((s) => s.costComputed)).toEqual([40, 30]);
  });

  it("hand-crafted odd-count: [5, 15, 25, 35, 45] → median 25", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 5),
      make("s1", "t2", 15),
      make("s1", "t3", 25),
      make("s1", "t4", 35),
      make("s1", "t5", 45),
    ];
    const result = detectTurnCostAnomalies(samples, 1);
    expect(result.baseline).toBe(25);
    expect(result.flagged.map((s) => s.costComputed)).toEqual([45, 35]);
  });
});

// ---------------------------------------------------------------------------
// Determinism (Regression Guard)
// ---------------------------------------------------------------------------

describe("stable output for stable input", () => {
  it("calling twice with identical input produces structurally identical output", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 20),
    ];
    const a = detectTurnCostAnomalies(samples, 5);
    const b = detectTurnCostAnomalies(samples, 5);
    expect(a.baseline).toBe(b.baseline);
    expect(a.ratio).toBe(b.ratio);
    expect(a.flagged.map((s) => s.turnId)).toEqual(b.flagged.map((s) => s.turnId));
  });
});

describe("does not mutate input", () => {
  it("input array is unchanged after detectTurnCostAnomalies", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 20),
    ];
    const snapshot = JSON.stringify(samples);
    detectTurnCostAnomalies(samples, 5);
    expect(JSON.stringify(samples)).toBe(snapshot);
  });

  it("costComputed values are unchanged after detectTurnCostAnomalies", () => {
    const samples: TurnCostSample[] = [
      make("s1", "t1", 1),
      make("s1", "t2", 2),
      make("s1", "t3", 3),
      make("s1", "t4", 20),
    ];
    const costSnapshot = samples.map((s) => s.costComputed);
    detectTurnCostAnomalies(samples, 5);
    expect(samples.map((s) => s.costComputed)).toEqual(costSnapshot);
  });
});
