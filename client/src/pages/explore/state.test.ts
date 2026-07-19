import { describe, expect, it } from "vitest";
import {
  buildPivotQuery,
  DEFAULT_PIVOT,
  mergePivotState,
  parsePivotState,
  serializePivotState,
  type PivotState,
} from "./state.js";

describe("parsePivotState", () => {
  it("returns the defaults when no xp.* keys are present", () => {
    expect(parsePivotState("")).toEqual(DEFAULT_PIVOT);
  });

  it("ignores unknown keys silently", () => {
    expect(parsePivotState("?xp.measure=costComputed&foo=bar")).toEqual(DEFAULT_PIVOT);
  });

  it("falls back to defaults for unrecognized enum values", () => {
    expect(parsePivotState("?xp.measure=garbage&xp.grain=foo").measure).toBe(DEFAULT_PIVOT.measure);
    expect(parsePivotState("?xp.measure=garbage&xp.grain=foo").grain).toBe(DEFAULT_PIVOT.grain);
  });

  it("parses scatter chart with x/y/size", () => {
    const state = parsePivotState(
      "?xp.chart=scatter&xp.x=costComputed&xp.y=wallMinutes&xp.size=apiCalls",
    );
    expect(state.chart).toBe("scatter");
    expect(state.x).toBe("costComputed");
    expect(state.y).toBe("wallMinutes");
    expect(state.size).toBe("apiCalls");
  });

  it("accepts the scatter-only 'totalTokens' preset on x/y/size", () => {
    const state = parsePivotState("?xp.chart=scatter&xp.x=totalTokens&xp.y=totalTokens");
    expect(state.x).toBe("totalTokens");
    expect(state.y).toBe("totalTokens");
  });
});

describe("serializePivotState", () => {
  it("returns empty string when state equals defaults", () => {
    expect(serializePivotState(DEFAULT_PIVOT)).toBe("");
  });

  it("encodes non-default fields under xp.*", () => {
    const next: PivotState = { ...DEFAULT_PIVOT, measure: "inputTokens", chart: "line" };
    const out = serializePivotState(next);
    expect(out).toContain("xp.measure=inputTokens");
    expect(out).toContain("xp.chart=line");
  });
});

describe("mergePivotState", () => {
  it("preserves non-pivot keys", () => {
    const merged = mergePivotState("?range=7d&project=claude-lens", {
      ...DEFAULT_PIVOT,
      measure: "inputTokens",
    });
    expect(merged).toContain("range=7d");
    expect(merged).toContain("project=claude-lens");
    expect(merged).toContain("xp.measure=inputTokens");
  });

  it("replaces prior xp.* keys", () => {
    const merged = mergePivotState("?xp.measure=costComputed&xp.grain=hour&range=7d", {
      ...DEFAULT_PIVOT,
      measure: "inputTokens",
    });
    expect(merged).toContain("xp.measure=inputTokens");
    expect(merged).not.toContain("xp.grain=hour");
    expect(merged).toContain("range=7d");
  });
});

describe("buildPivotQuery", () => {
  const filterShape = { range: { from: "2026-07-13T00:00:00Z", to: "2026-07-20T00:00:00Z" } };

  it("builds a SeriesMetricsQuery for chart=bar, mode=series", () => {
    const q = buildPivotQuery(DEFAULT_PIVOT, filterShape);
    expect(q).toMatchObject({ mode: "series", measures: ["costComputed"], dimensions: ["tool"] });
  });

  it("builds a DistributionMetricsQuery when mode=distribution", () => {
    const q = buildPivotQuery({ ...DEFAULT_PIVOT, mode: "distribution" }, filterShape);
    expect(q).toMatchObject({ mode: "distribution", distributionEntity: "session" });
  });

  it("builds a ScatterMetricsQuery when chart=scatter", () => {
    const q = buildPivotQuery(
      { ...DEFAULT_PIVOT, chart: "scatter", x: "costComputed", y: "wallMinutes" },
      filterShape,
    );
    expect(q).toMatchObject({
      mode: "scatter",
      entity: "session",
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
    });
  });
});
