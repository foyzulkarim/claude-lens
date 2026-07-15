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
    expect(ghost.name).not.toBe(input.label);
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
