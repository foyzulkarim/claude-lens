import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "../../shared/metrics-contract.js";
import { alignPreviousPeriod, computeDistribution, movingAverage7 } from "./distributions.js";

function points(values: (number | null)[]): SeriesPoint[] {
  return values.map((value, i) => ({ t: `t${i}`, value }));
}

describe("computeDistribution", () => {
  describe("percentiles (nearest-rank)", () => {
    it("computes p50/p90/p99 on a known 100-value array", () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = computeDistribution(values);
      expect(result.p50).toBe(50);
      expect(result.p90).toBe(90);
      expect(result.p99).toBe(99);
    });

    it("computes correctly on a small known array", () => {
      const result = computeDistribution([10, 20, 30]);
      expect(result.p50).toBe(20);
      expect(result.p90).toBe(30);
      expect(result.p99).toBe(30);
    });

    it("sorts unsorted input before computing", () => {
      const sorted = computeDistribution([10, 20, 30]);
      const unsorted = computeDistribution([30, 10, 20]);
      expect(unsorted).toEqual(sorted);
    });

    it("returns the single value for all percentiles when N=1", () => {
      const result = computeDistribution([42]);
      expect(result.p50).toBe(42);
      expect(result.p90).toBe(42);
      expect(result.p99).toBe(42);
    });
  });

  describe("histogram (10 equal-width buckets over [min, max])", () => {
    it("buckets a known spread correctly", () => {
      // 20 values evenly spread 0..190 (step 10) -> range [0,190], width 19 per bucket
      const values = Array.from({ length: 20 }, (_, i) => i * 10);
      const result = computeDistribution(values);
      expect(result.histogram).toHaveLength(10);
      expect(result.histogram[0]).toEqual({ rangeStart: 0, rangeEnd: 19, count: 2 });
      const totalCount = result.histogram.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(20);
    });

    it("N=0 produces an empty histogram", () => {
      expect(computeDistribution([]).histogram).toEqual([]);
    });

    it("N=1 collapses to a single bucket", () => {
      const result = computeDistribution([42]);
      expect(result.histogram).toEqual([{ rangeStart: 42, rangeEnd: 42, count: 1 }]);
    });

    it("all-identical values collapse to a single bucket", () => {
      const result = computeDistribution([5, 5, 5, 5]);
      expect(result.histogram).toEqual([{ rangeStart: 5, rangeEnd: 5, count: 4 }]);
    });

    it("pins actual bucket assignment for fractional (cost-like) values, including float-boundary drift", () => {
      // 11 evenly-spaced values 0..1.0 step 0.1 (representative of costComputed
      // dollar amounts). With exact rational math every bucket i would hold
      // exactly the value i*0.1 (bucket 9 holding both 0.9 and the clamped
      // 1.0). Floating-point division/subtraction drifts some boundary values
      // by a fraction of a cent, which moves them a bucket over from that
      // ideal — this test pins the actual (not idealized) computed shape so a
      // change to the bucketing math is caught either way.
      const values = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
      const result = computeDistribution(values);
      expect(result.histogram).toEqual([
        { rangeStart: 0, rangeEnd: 0.1, count: 1 },
        { rangeStart: 0.1, rangeEnd: 0.2, count: 1 },
        { rangeStart: 0.2, rangeEnd: 0.30000000000000004, count: 2 },
        { rangeStart: 0.30000000000000004, rangeEnd: 0.4, count: 0 },
        { rangeStart: 0.4, rangeEnd: 0.5, count: 1 },
        { rangeStart: 0.5, rangeEnd: 0.6000000000000001, count: 2 },
        { rangeStart: 0.6000000000000001, rangeEnd: 0.7000000000000001, count: 1 },
        { rangeStart: 0.7000000000000001, rangeEnd: 0.8, count: 0 },
        { rangeStart: 0.8, rangeEnd: 0.9, count: 1 },
        { rangeStart: 0.9, rangeEnd: 1, count: 2 },
      ]);
      const totalCount = result.histogram.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(11);
    });
  });

  describe("pareto (sorted-descending curve + top-decile share)", () => {
    it("computes curve and topDecileValuePct on a known skewed array", () => {
      // 10 entities, total = 900 (810 + nine 10s). Top entity dominates.
      const values = [810, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const result = computeDistribution(values);
      const pareto = result.pareto;
      expect(pareto).toBeDefined();
      expect(pareto?.curve).toHaveLength(10);
      expect(pareto?.curve[0]).toEqual({ entityPct: 10, cumulativeValuePct: 90 });
      expect(pareto?.curve[9]).toEqual({ entityPct: 100, cumulativeValuePct: 100 });
      // top ceil(10*0.1)=1 entity -> 810/900 = 90%
      expect(pareto?.topDecileValuePct).toBe(90);
    });

    it("single entity: top decile is the whole population", () => {
      const result = computeDistribution([10]);
      expect(result.pareto).toEqual({
        curve: [{ entityPct: 100, cumulativeValuePct: 100 }],
        topDecileValuePct: 100,
      });
    });

    it("all-zero population produces a defined curve of 0%s, not undefined", () => {
      // total === 0 is a real, reachable state (e.g. a batch of free/cached
      // calls) distinct from N=0 (empty population) — pareto stays defined,
      // just entirely flat at 0%, per the total===0 guard in buildPareto.
      const result = computeDistribution([0, 0, 0, 0]);
      expect(result.pareto).toEqual({
        curve: [
          { entityPct: 25, cumulativeValuePct: 0 },
          { entityPct: 50, cumulativeValuePct: 0 },
          { entityPct: 75, cumulativeValuePct: 0 },
          { entityPct: 100, cumulativeValuePct: 0 },
        ],
        topDecileValuePct: 0,
      });
    });

    it("topDecileCount increments at its N boundary (N=11 -> top 2 entities, not 1)", () => {
      // N=10 and N=1 (the existing tests) both land on ceil(N*0.1)=1; this
      // covers the first N where the count actually increments to 2.
      const values = Array.from({ length: 11 }, (_, i) => i + 1); // 1..11, total=66
      const result = computeDistribution(values);
      // top 2 entities (11 + 10 = 21) of total 66
      expect(result.pareto?.topDecileValuePct).toBeCloseTo((21 / 66) * 100, 10);
    });
  });

  describe("empty population (honest-null)", () => {
    it("produces a fully honest-null Distribution", () => {
      const result = computeDistribution([]);
      expect(result.p50).toBeNull();
      expect(result.p90).toBeNull();
      expect(result.p99).toBeNull();
      expect(result.histogram).toEqual([]);
      expect(result.pareto).toBeUndefined();
    });
  });

  describe("negative values", () => {
    it("handles a population with a negative contributor across percentiles/histogram/pareto", () => {
      // A real reachable path: wallMinutes only guards against NaN, not
      // endedAt < startedAt, so a negative duration can enter this population.
      const result = computeDistribution([-5, 10, 20]);
      expect(result.p50).toBe(10);
      expect(result.p90).toBe(20);
      expect(result.p99).toBe(20);
      expect(result.histogram).toEqual([
        { rangeStart: -5, rangeEnd: -2.5, count: 1 },
        { rangeStart: -2.5, rangeEnd: 0, count: 0 },
        { rangeStart: 0, rangeEnd: 2.5, count: 0 },
        { rangeStart: 2.5, rangeEnd: 5, count: 0 },
        { rangeStart: 5, rangeEnd: 7.5, count: 0 },
        { rangeStart: 7.5, rangeEnd: 10, count: 0 },
        { rangeStart: 10, rangeEnd: 12.5, count: 1 },
        { rangeStart: 12.5, rangeEnd: 15, count: 0 },
        { rangeStart: 15, rangeEnd: 17.5, count: 0 },
        { rangeStart: 17.5, rangeEnd: 20, count: 1 },
      ]);
      // total (25) is smaller than the running sum after the first two
      // descending entries (20 + 10 = 30) because the negative entry is last
      // in descending order — cumulativeValuePct legitimately exceeds 100%
      // mid-curve before settling back to exactly 100% at the final point.
      expect(result.pareto?.curve).toEqual([
        { entityPct: (1 / 3) * 100, cumulativeValuePct: 80 },
        { entityPct: (2 / 3) * 100, cumulativeValuePct: 120 },
        { entityPct: 100, cumulativeValuePct: 100 },
      ]);
      expect(result.pareto?.topDecileValuePct).toBe(80);
    });
  });
});

describe("movingAverage7", () => {
  it("expands the window for early points", () => {
    const input = points([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const result = movingAverage7(input);
    expect(result[0]?.value).toBe(10);
    expect(result[1]?.value).toBe(15);
    expect(result[2]?.value).toBe(20);
    expect(result[3]?.value).toBe(25);
    expect(result[4]?.value).toBe(30);
    expect(result[5]?.value).toBe(35);
  });

  it("uses a full 7-point trailing window from index 6 onward", () => {
    const input = points([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    const result = movingAverage7(input);
    expect(result[6]?.value).toBe(40); // avg(10..70)
    expect(result[7]?.value).toBe(50); // avg(20..80)
    expect(result[8]?.value).toBe(60); // avg(30..90)
    expect(result[9]?.value).toBe(70); // avg(40..100)
  });

  it("skips null values within a partial-null window", () => {
    const input = points([10, null, 30]);
    const result = movingAverage7(input);
    expect(result[2]?.value).toBe(20); // avg(10, 30), null excluded
  });

  it("skips null values within a full, saturated 7-point trailing window", () => {
    // A quiet day inside an otherwise-active week — the more common
    // production shape than the partial-window case above.
    const input = points([10, 20, 30, 40, 50, null, 70, 80, 90, 100]);
    const result = movingAverage7(input);
    expect(result[6]?.value).toBeCloseTo(220 / 6, 10); // avg(10,20,30,40,50,70), null excluded
  });

  it("keeps an all-null series entirely null", () => {
    const input = points([null, null, null]);
    const result = movingAverage7(input);
    expect(result.every((p) => p.value === null)).toBe(true);
  });
});

describe("alignPreviousPeriod", () => {
  it("aligns equal-length arrays 1:1 by index", () => {
    const current = points([1, 2, 3]);
    const previous = points([10, 20, 30]);
    const result = alignPreviousPeriod(current, previous);
    expect(result.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(result.map((p) => p.t)).toEqual(["t0", "t1", "t2"]);
  });

  it("truncates when previous is longer than current", () => {
    const current = points([1, 2]);
    const previous = points([10, 20, 30, 40]);
    const result = alignPreviousPeriod(current, previous);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.value)).toEqual([10, 20]);
  });

  it("pads with null when previous is shorter than current", () => {
    const current = points([1, 2, 3, 4]);
    const previous = points([10, 20]);
    const result = alignPreviousPeriod(current, previous);
    expect(result).toHaveLength(4);
    expect(result.map((p) => p.value)).toEqual([10, 20, null, null]);
  });
});
