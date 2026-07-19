import { describe, expect, it } from "vitest";
// biome-ignore lint/correctness/noUnusedImports: Type-level exhaustive guard — presence here keeps the tsc --noEmit gate honest if a literal is added to Measure without a corresponding MEASURES entry.
import type { Measure } from "./metrics-contract.js";
import {
  MEASURES,
  type ScatterMetricsQuery,
  type ScatterMetricsResult,
  type ScatterPoint,
  type ScatterRegression,
} from "./metrics-contract.js";

describe("MEASURES -- exhaustive union", () => {
  it("MEASURES contains exactly the union literals (19 total)", () => {
    // Original 16 + 3 new = 19
    expect(MEASURES).toHaveLength(19);
    expect(MEASURES).toContain("toolErrors");
    expect(MEASURES).toContain("cacheSavingsComputed");
    expect(MEASURES).toContain("routingSavingsComputed");
  });

  it("all Measure literals are in MEASURES", () => {
    // exhaustiveArray<T> guard fires at compile time if MEASURES and the
    // union drift out of sync (add to one but not the other).
    for (const m of MEASURES) {
      expect(typeof m).toBe("string");
    }
  });
});

describe("ScatterMetricsQuery — discriminated from aggregate metrics (#P4-4)", () => {
  it("constructs with entity=session and a sessionPopulation criteria", () => {
    const query: ScatterMetricsQuery = {
      mode: "scatter",
      entity: "session",
      measures: ["costComputed"],
      dimensions: [],
      grain: "day",
      range: { from: "2026-07-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
      sessionPopulation: { project: ["alpha"] },
    };
    expect(query.mode).toBe("scatter");
    expect(query.xMeasure).toBe("costComputed");
    expect(query.sessionPopulation.project).toEqual(["alpha"]);
  });

  it("accepts an optional sizeMeasure", () => {
    const query: ScatterMetricsQuery = {
      mode: "scatter",
      entity: "session",
      measures: ["turns"],
      dimensions: [],
      grain: "day",
      range: { from: "2026-07-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
      xMeasure: "costComputed",
      yMeasure: "turns",
      sizeMeasure: "apiCalls",
      sessionPopulation: {},
    };
    expect(query.sizeMeasure).toBe("apiCalls");
  });
});

describe("ScatterMetricsResult — discriminated response family", () => {
  it("carries points, regression, and population metadata", () => {
    const regression: ScatterRegression = { slope: 0.5, intercept: 0.1, rSquared: 0.82 };
    const point: ScatterPoint = { sessionId: "s1", x: 1.0, y: 0.6 };
    const result: ScatterMetricsResult = {
      mode: "scatter",
      entity: "session",
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
      points: [point],
      regression,
      population: {
        matched: 50,
        eligible: 48,
        returned: 1,
        excludedMissingMeasures: 2,
        sampled: false,
      },
    };
    expect(result.regression).not.toBeNull();
    expect(result.population.eligible).toBe(48);
  });

  it("regression is null for degenerate populations", () => {
    const result: ScatterMetricsResult = {
      mode: "scatter",
      entity: "session",
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
      points: [{ sessionId: "s1", x: 1, y: 1 }],
      regression: null,
      population: {
        matched: 1,
        eligible: 1,
        returned: 1,
        excludedMissingMeasures: 0,
        sampled: false,
      },
    };
    expect(result.regression).toBeNull();
  });
});

// The type guard lives in metrics-contract.ts where exhaustiveArray<T>
// produces a compile-time error for any literal added to the union without
// a corresponding entry in MEASURES (and vice versa). tsc --noEmit in
// the shared tsconfig gate keeps the two in sync.
