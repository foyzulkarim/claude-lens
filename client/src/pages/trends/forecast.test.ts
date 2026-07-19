import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "../../../../shared/metrics-contract.js";
import { computeForecast, daysInUtcMonth, utcMonthStart } from "./forecast.js";

function points(values: number[], monthStart = "2026-07-01T00:00:00.000Z"): SeriesPoint[] {
  const start = new Date(monthStart).getTime();
  return values.map((value, i) => ({
    t: new Date(start + i * 24 * 60 * 60 * 1000).toISOString(),
    value,
  }));
}

describe("utcMonthStart / daysInUtcMonth", () => {
  it("resolves July's 31 days", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    expect(utcMonthStart(now).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(daysInUtcMonth(now)).toBe(31);
  });
});

describe("computeForecast — insufficient data", () => {
  it("returns null projection/band with fewer than 3 days of data", () => {
    const now = new Date("2026-07-03T12:00:00.000Z");
    const result = computeForecast(points([10, 10]), { now, method: "linear", budget: null });
    expect(result.mtd).toBe(20);
    expect(result.projectedEndOfMonth).toBeNull();
    expect(result.bandLow).toBeNull();
    expect(result.bandHigh).toBeNull();
    expect(result.crossesBudgetAt).toBeNull();
  });

  it("produces a non-null projection at exactly the 3-day minimum", () => {
    const now = new Date("2026-07-04T12:00:00.000Z");
    const result = computeForecast(points([10, 10, 10]), { now, method: "linear", budget: null });
    expect(result.mtd).toBe(30);
    expect(result.projectedEndOfMonth).not.toBeNull();
    expect(result.bandLow).not.toBeNull();
    expect(result.bandHigh).not.toBeNull();
  });
});

describe("computeForecast — linear method", () => {
  it("projects flat daily spend to the full month", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    // 10 days of $10/day -> mtd $100, 21 days remaining -> projected $100 + 10*21 = $310
    const result = computeForecast(points(Array(10).fill(10)), {
      now,
      method: "linear",
      budget: null,
    });
    expect(result.mtd).toBe(100);
    expect(result.projectedEndOfMonth).toBeCloseTo(310, 5);
  });

  it("band widens with variance and never goes negative on the low end", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const result = computeForecast(points([5, 40, 5, 40, 5, 40, 5, 40, 5, 40]), {
      now,
      method: "linear",
      budget: null,
    });
    expect(result.bandLow).toBeGreaterThanOrEqual(0);
    expect(result.bandHigh).toBeGreaterThan(result.projectedEndOfMonth ?? 0);
    expect(result.bandLow).toBeLessThan(result.projectedEndOfMonth ?? 0);
  });

  it("floors the band spread at 5% of the projection for near-zero variance", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const result = computeForecast(points(Array(10).fill(10)), {
      now,
      method: "linear",
      budget: null,
    });
    const projected = result.projectedEndOfMonth ?? 0;
    expect(result.bandHigh).toBeCloseTo(projected * 1.05, 5);
  });
});

describe("computeForecast — EWMA method", () => {
  it("weights recent days more heavily than the linear average", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    // Ramping spend: linear average is 5.5, EWMA leans toward the later (higher) days.
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const linear = computeForecast(points(vals), { now, method: "linear", budget: null });
    const ewma = computeForecast(points(vals), { now, method: "ewma", budget: null });
    expect(ewma.projectedEndOfMonth ?? 0).toBeGreaterThan(linear.projectedEndOfMonth ?? 0);
  });
});

describe("computeForecast — budget crossing", () => {
  it("flags no crossing when the upper band stays under budget", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const result = computeForecast(points(Array(10).fill(1)), {
      now,
      method: "linear",
      budget: 10_000,
    });
    expect(result.crossesBudgetAt).toBeNull();
  });

  it("flags a crossing date when the upper band exceeds budget before month-end", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const result = computeForecast(points(Array(10).fill(10)), {
      now,
      method: "linear",
      budget: 150,
    });
    expect(result.crossesBudgetAt).not.toBeNull();
    expect(result.crossesBudgetAt).toMatch(/^2026-07-\d{2}$/);
  });

  it("null budget never produces a crossing date", () => {
    const now = new Date("2026-07-11T12:00:00.000Z");
    const result = computeForecast(points(Array(10).fill(1000)), {
      now,
      method: "linear",
      budget: null,
    });
    expect(result.crossesBudgetAt).toBeNull();
  });
});
