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
