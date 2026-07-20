import { describe, expect, it } from "vitest";
import type { Series } from "../../../shared/metrics-contract.js";
import { buildTimeseriesOption } from "./timeseries.js";
import { formatUnitValue, UNIT_MEASURES } from "./units.js";

function series(overrides: Partial<Series> = {}): Series {
  return {
    measure: "costComputed",
    dimensionKey: "time",
    label: "Cost",
    points: [
      { t: "2026-07-01T00:00:00Z", value: 1 },
      { t: "2026-07-02T00:00:00Z", value: 2 },
    ],
    ...overrides,
  };
}

describe("buildTimeseriesOption — family rendering", () => {
  it("builds an area-family option", () => {
    const option = buildTimeseriesOption([series()], { family: "area", unit: "$" });
    const [entry] = option.series as { type: string; areaStyle?: object }[];
    expect(entry.type).toBe("line");
    expect(entry.areaStyle).toBeDefined();
  });

  it("builds a bars-family option", () => {
    const option = buildTimeseriesOption([series()], { family: "bars", unit: "$" });
    const [entry] = option.series as { type: string }[];
    expect(entry.type).toBe("bar");
  });

  it("builds a lines-family option without area fill", () => {
    const option = buildTimeseriesOption([series()], { family: "lines", unit: "$" });
    const [entry] = option.series as { type: string; areaStyle?: object }[];
    expect(entry.type).toBe("line");
    // Line must not carry areaStyle — that's the entire point of having
    // both "lines" and "area" families (Explore page's chart-type picker).
    expect(entry.areaStyle).toBeUndefined();
  });

  it("bars-family series are unstacked by default", () => {
    const option = buildTimeseriesOption([series()], { family: "bars", unit: "$" });
    const [entry] = option.series as { stack?: string }[];
    expect(entry.stack).toBeUndefined();
  });

  it("stacked: true puts every bars-family series on one shared stack", () => {
    const a = series({ label: "claude-lens" });
    const b = series({ label: "claude-code" });
    const option = buildTimeseriesOption([a, b], { family: "bars", unit: "$", stacked: true });
    const entries = option.series as { stack?: string }[];
    expect(entries.map((e) => e.stack)).toEqual(["total", "total"]);
  });
});

describe("buildTimeseriesOption — null and empty handling", () => {
  it("renders a null point as a gap, not zero", () => {
    const input = series({
      points: [
        { t: "2026-07-01T00:00:00Z", value: 1 },
        { t: "2026-07-02T00:00:00Z", value: null },
      ],
    });
    const option = buildTimeseriesOption([input], { family: "area", unit: "$" });
    const [entry] = option.series as { data: [string, number | null][] }[];
    expect(entry.data[1][1]).toBeNull();
  });

  it("handles an empty series: [] input", () => {
    expect(() => buildTimeseriesOption([], { family: "area", unit: "$" })).not.toThrow();
    const option = buildTimeseriesOption([], { family: "area", unit: "$" });
    expect(option.series).toEqual([]);
  });
});

describe("buildTimeseriesOption — compare ghost", () => {
  it("renders compareGhost as a distinct dashed series", () => {
    const input = series({
      compareGhost: [
        { t: "2026-06-24T00:00:00Z", value: 0.5 },
        { t: "2026-06-25T00:00:00Z", value: 1.5 },
      ],
    });
    const option = buildTimeseriesOption([input], { family: "area", unit: "$" });
    const entries = option.series as { name?: string; lineStyle?: { type?: string } }[];
    expect(entries).toHaveLength(2);
    const ghost = entries[1];
    expect(ghost.lineStyle?.type).toBe("dashed");
    expect(ghost.name).toBe(`${input.label} (previous period)`);
  });
});

describe("buildTimeseriesOption — malformed input", () => {
  it("does not throw when a series has an empty points array", () => {
    const input = series({ points: [] });
    expect(() => buildTimeseriesOption([input], { family: "area", unit: "$" })).not.toThrow();
    const option = buildTimeseriesOption([input], { family: "area", unit: "$" });
    const [entry] = option.series as { data: unknown[] }[];
    expect(entry.data).toEqual([]);
  });
});

describe("buildTimeseriesOption — unit formatting", () => {
  it("formats $ as currency", () => {
    expect(formatUnitValue(1234.5, "$")).toBe("$1,234.50");
  });

  it("formats tokens as compact counts", () => {
    expect(formatUnitValue(1_500_000, "tokens")).toBe("1.5M");
  });

  it("formats calls as plain integers", () => {
    expect(formatUnitValue(42.7, "calls")).toBe("43");
  });

  it("maps units to measures correctly", () => {
    expect(UNIT_MEASURES.$).toEqual(["costComputed"]);
    expect(UNIT_MEASURES.tokens).toEqual(["inputTokens", "outputTokens"]);
    expect(UNIT_MEASURES.calls).toEqual(["apiCalls"]);
  });
});

describe("buildTimeseriesOption — multiple series", () => {
  it("preserves label/dimensionKey per series, none merged or dropped", () => {
    const a = series({ label: "claude-lens", dimensionKey: "project:claude-lens" });
    const b = series({ label: "claude-code", dimensionKey: "project:claude-code" });
    const option = buildTimeseriesOption([a, b], { family: "area", unit: "$" });
    const entries = option.series as { name?: string }[];
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(["claude-lens", "claude-code"]);
  });
});

describe("buildTimeseriesOption — multi-measure disambiguation", () => {
  it("folds the measure's human name into the series name when the chart requests more than one measure (e.g. the tokens unit's inputTokens+outputTokens pair) and every series shares the generic 'All' group label", () => {
    const input = series({ measure: "inputTokens", label: "All" });
    const output = series({ measure: "outputTokens", label: "All" });
    const option = buildTimeseriesOption([input, output], { family: "bars", unit: "tokens" });
    const entries = option.series as { name?: string }[];
    expect(entries.map((e) => e.name)).toEqual(["Input tokens", "Output tokens"]);
  });

  it("combines a real group label with the measure name instead of just the measure name", () => {
    const input = series({ measure: "inputTokens", label: "claude-lens" });
    const output = series({ measure: "outputTokens", label: "claude-lens" });
    const option = buildTimeseriesOption([input, output], { family: "bars", unit: "tokens" });
    const entries = option.series as { name?: string }[];
    expect(entries.map((e) => e.name)).toEqual([
      "claude-lens · Input tokens",
      "claude-lens · Output tokens",
    ]);
  });

  it("leaves the plain group label alone when only one measure is present, even if it's 'All'", () => {
    const input = series({ measure: "costComputed", label: "All" });
    const option = buildTimeseriesOption([input], { family: "bars", unit: "$" });
    const entries = option.series as { name?: string }[];
    expect(entries.map((e) => e.name)).toEqual(["All"]);
  });
});
