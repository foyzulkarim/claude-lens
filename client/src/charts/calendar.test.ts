import { describe, expect, it } from "vitest";
import type { Series } from "../../../shared/metrics-contract.js";
import { buildCalendarHeatmapOption } from "./calendar.js";

function series(overrides: Partial<Series> = {}): Series {
  return {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Cost",
    points: [
      { t: "2026-07-01T00:00:00Z", value: 1 },
      { t: "2026-07-02T00:00:00Z", value: 5 },
    ],
    ...overrides,
  };
}

const RANGE = { from: "2026-07-01T00:00:00Z", to: "2026-07-03T00:00:00Z" };

describe("buildCalendarHeatmapOption", () => {
  it("maps points to [date, value] pairs keyed by day", () => {
    const option = buildCalendarHeatmapOption([series()], { unit: "$", range: RANGE });
    const [heatmapSeries] = option.series as { data: [string, number][] }[];
    expect(heatmapSeries.data).toEqual([
      ["2026-07-01", 1],
      ["2026-07-02", 5],
    ]);
  });

  it("sets the calendar range from the requested query range", () => {
    const option = buildCalendarHeatmapOption([series()], { unit: "$", range: RANGE });
    expect(option.calendar).toMatchObject({ range: ["2026-07-01", "2026-07-03"] });
  });

  it("treats a null point as 0 (a day with no activity), not a dropped cell", () => {
    const input = series({
      points: [
        { t: "2026-07-01T00:00:00Z", value: null },
        { t: "2026-07-02T00:00:00Z", value: 5 },
      ],
    });
    const option = buildCalendarHeatmapOption([input], { unit: "$", range: RANGE });
    const [heatmapSeries] = option.series as { data: [string, number][] }[];
    expect(heatmapSeries.data[0]).toEqual(["2026-07-01", 0]);
  });

  it("handles an empty series: [] input without throwing", () => {
    expect(() => buildCalendarHeatmapOption([], { unit: "$", range: RANGE })).not.toThrow();
    const option = buildCalendarHeatmapOption([], { unit: "$", range: RANGE });
    const [heatmapSeries] = option.series as { data: unknown[] }[];
    expect(heatmapSeries.data).toEqual([]);
  });

  it("degenerate all-zero data still produces a usable (non-inverted) visualMap range", () => {
    const input = series({
      points: [
        { t: "2026-07-01T00:00:00Z", value: 0 },
        { t: "2026-07-02T00:00:00Z", value: 0 },
      ],
    });
    const option = buildCalendarHeatmapOption([input], { unit: "$", range: RANGE });
    const visualMap = option.visualMap as { min: number; max: number };
    expect(visualMap.min).toBe(0);
    expect(visualMap.max).toBeGreaterThan(0);
  });
});
