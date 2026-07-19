import { describe, expect, it } from "vitest";
import type { HourWeekdayCell } from "../pages/trends/hourWeekdayBuckets.js";
import { buildHourWeekdayHeatmapOption } from "./heatmap.js";

describe("buildHourWeekdayHeatmapOption", () => {
  it("maps each cell to an [hour, weekday, value] triple", () => {
    const cells: HourWeekdayCell[] = [
      { hour: 14, weekday: 2, value: 10 },
      { hour: 8, weekday: 0, value: 3 },
    ];
    const option = buildHourWeekdayHeatmapOption(cells);
    const [series] = option.series as { data: [number, number, number][] }[];
    expect(series.data).toEqual([
      [14, 2, 10],
      [8, 0, 3],
    ]);
  });

  it("handles an empty cells: [] input without throwing", () => {
    expect(() => buildHourWeekdayHeatmapOption([])).not.toThrow();
    const option = buildHourWeekdayHeatmapOption([]);
    const [series] = option.series as { data: unknown[] }[];
    expect(series.data).toEqual([]);
  });

  it("xAxis/yAxis carry 24 hour and 7 Monday-first weekday labels", () => {
    const option = buildHourWeekdayHeatmapOption([]);
    expect((option.xAxis as { data: string[] }).data).toHaveLength(24);
    expect((option.yAxis as { data: string[] }).data).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("degenerate all-zero data still produces a usable visualMap range", () => {
    const cells: HourWeekdayCell[] = [{ hour: 0, weekday: 0, value: 0 }];
    const option = buildHourWeekdayHeatmapOption(cells);
    const visualMap = option.visualMap as { min: number; max: number };
    expect(visualMap.min).toBe(0);
    expect(visualMap.max).toBeGreaterThan(0);
  });
});
