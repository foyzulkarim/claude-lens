import { describe, expect, it } from "vitest";
import { buildForecastBandOption, type ForecastPoint, type MonthForecast } from "./forecast.js";

const ACTUAL: ForecastPoint[] = [
  { t: "2026-07-01", value: 10 },
  { t: "2026-07-02", value: 25 },
];

function forecast(overrides: Partial<MonthForecast> = {}): MonthForecast {
  return {
    mtd: 25,
    method: "linear",
    projectedEndOfMonth: 300,
    bandLow: 250,
    bandHigh: 350,
    budget: null,
    crossesBudgetAt: null,
    ...overrides,
  };
}

describe("buildForecastBandOption", () => {
  it("always includes an Actual series with the raw cumulative points", () => {
    const option = buildForecastBandOption(ACTUAL, forecast(), "2026-07-31");
    const series = option.series as { name?: string; data: unknown[] }[];
    const actualSeries = series.find((s) => s.name === "Actual");
    expect(actualSeries?.data).toEqual([
      ["2026-07-01", 10],
      ["2026-07-02", 25],
    ]);
  });

  it("adds a dashed Projected series from the last actual point to the month-end projection", () => {
    const option = buildForecastBandOption(ACTUAL, forecast(), "2026-07-31");
    const series = option.series as { name?: string; data: unknown[] }[];
    const projected = series.find((s) => s.name === "Projected");
    expect(projected?.data).toEqual([
      ["2026-07-02", 25],
      ["2026-07-31", 300],
    ]);
  });

  it("omits the Projected series when projectedEndOfMonth is null (insufficient data)", () => {
    const option = buildForecastBandOption(
      ACTUAL,
      forecast({ projectedEndOfMonth: null, bandLow: null, bandHigh: null }),
      "2026-07-31",
    );
    const series = option.series as { name?: string }[];
    expect(series.find((s) => s.name === "Projected")).toBeUndefined();
    expect(series.find((s) => s.name === "Band (range)")).toBeUndefined();
  });

  it("band range series carries (bandHigh - bandLow) as its stacked value", () => {
    const option = buildForecastBandOption(ACTUAL, forecast(), "2026-07-31");
    const series = option.series as { name?: string; data: unknown[] }[];
    const bandRange = series.find((s) => s.name === "Band (range)");
    expect(bandRange?.data).toEqual([
      ["2026-07-02", 0],
      ["2026-07-31", 100],
    ]);
  });

  it("adds a budget markLine only when a budget is set", () => {
    const withBudget = buildForecastBandOption(ACTUAL, forecast({ budget: 300 }), "2026-07-31");
    const withoutBudget = buildForecastBandOption(ACTUAL, forecast({ budget: null }), "2026-07-31");
    const seriesWith = withBudget.series as { name?: string }[];
    const seriesWithout = withoutBudget.series as { name?: string }[];
    expect(seriesWith.some((s) => s.name === "Budget cap")).toBe(true);
    expect(seriesWithout.some((s) => s.name === "Budget cap")).toBe(false);
  });

  it("handles an empty actual: [] input without throwing", () => {
    expect(() => buildForecastBandOption([], forecast(), "2026-07-31")).not.toThrow();
    const option = buildForecastBandOption([], forecast(), "2026-07-31");
    const series = option.series as { name?: string }[];
    expect(series.find((s) => s.name === "Projected")).toBeUndefined();
  });
});
