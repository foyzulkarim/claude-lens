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

  // Issue #122: the projection used to read `series[0]` only, which was
  // correct while every caller requested exactly one measure. Once the
  // tokens unit meant four measures, that silently plotted `inputTokens`
  // alone — the uncached slice, a few digits a day.
  describe("all-series aggregation (#122)", () => {
    const tokenSeries: Series[] = (
      [
        ["inputTokens", 10],
        ["outputTokens", 200],
        ["cacheCreateTokens", 3_000],
        ["cacheReadTokens", 40_000],
      ] as const
    ).map(([measure, value]) => ({
      measure,
      dimensionKey: "time",
      label: "All",
      points: [
        { t: "2026-07-01T00:00:00Z", value },
        { t: "2026-07-02T00:00:00Z", value: value * 2 },
      ],
    }));

    it("sums every returned series into one value per day", () => {
      const option = buildCalendarHeatmapOption(tokenSeries, { unit: "tokens", range: RANGE });
      const [heatmapSeries] = option.series as { data: [string, number][] }[];
      expect(heatmapSeries.data).toEqual([
        ["2026-07-01", 43_210],
        ["2026-07-02", 86_420],
      ]);
    });

    it("keeps a day that only some series cover", () => {
      const sparse: Series[] = [
        series({ measure: "inputTokens", points: [{ t: "2026-07-01T00:00:00Z", value: 1 }] }),
        series({ measure: "outputTokens", points: [{ t: "2026-07-02T00:00:00Z", value: 2 }] }),
      ];
      const option = buildCalendarHeatmapOption(sparse, { unit: "tokens", range: RANGE });
      const [heatmapSeries] = option.series as { data: [string, number][] }[];
      expect(heatmapSeries.data).toEqual([
        ["2026-07-01", 1],
        ["2026-07-02", 2],
      ]);
    });

    it("scales the colour ramp to the largest summed day, not the largest single point", () => {
      const option = buildCalendarHeatmapOption(tokenSeries, { unit: "tokens", range: RANGE });
      const visualMap = option.visualMap as { max: number };
      expect(visualMap.max).toBe(86_420);
    });

    it("treats null and non-finite points as 0 without dropping the day", () => {
      const withHoles: Series[] = [
        series({
          measure: "inputTokens",
          points: [
            { t: "2026-07-01T00:00:00Z", value: null },
            { t: "2026-07-02T00:00:00Z", value: Number.NaN },
          ],
        }),
        series({
          measure: "outputTokens",
          points: [
            { t: "2026-07-01T00:00:00Z", value: null },
            { t: "2026-07-02T00:00:00Z", value: 7 },
          ],
        }),
      ];
      const option = buildCalendarHeatmapOption(withHoles, { unit: "tokens", range: RANGE });
      const [heatmapSeries] = option.series as { data: [string, number][] }[];
      expect(heatmapSeries.data).toEqual([
        ["2026-07-01", 0],
        ["2026-07-02", 7],
      ]);
    });

    it("formats the tooltip value in the active unit, not as a raw number", () => {
      const option = buildCalendarHeatmapOption(tokenSeries, { unit: "tokens", range: RANGE });
      const formatter = (option.tooltip as { formatter: (params: unknown) => string }).formatter;
      expect(formatter({ value: ["2026-07-01", 43_210] })).toBe("2026-07-01: 43K");
      expect(formatter({})).toBe("");
    });

    it("names the series for the aggregate, not the first series' group label", () => {
      const option = buildCalendarHeatmapOption(tokenSeries, { unit: "tokens", range: RANGE });
      const [heatmapSeries] = option.series as { name: string }[];
      expect(heatmapSeries.name).toContain("tokens");
    });

    // Currency mode still requests exactly one measure, so summation must be
    // a no-op there — the values below are the pre-#122 projection verbatim.
    it("leaves single-series (currency) output value-identical", () => {
      const option = buildCalendarHeatmapOption([series()], { unit: "$", range: RANGE });
      const [heatmapSeries] = option.series as { data: [string, number][] }[];
      expect(heatmapSeries.data).toEqual([
        ["2026-07-01", 1],
        ["2026-07-02", 5],
      ]);
    });
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
