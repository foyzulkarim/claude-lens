import { describe, expect, it } from "vitest";
import { computeDistribution } from "./distributions.js";

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
