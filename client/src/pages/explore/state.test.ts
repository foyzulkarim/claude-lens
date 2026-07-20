import { describe, expect, it } from "vitest";
import {
  buildPivotQuery,
  buildScatterDrillPath,
  buildSliceDrillSearch,
  DEFAULT_PIVOT,
  mergePivotState,
  type PivotState,
  parsePivotState,
  serializePivotState,
} from "./state.js";

describe("parsePivotState", () => {
  it("returns the defaults when no xp.* keys are present", () => {
    expect(parsePivotState("")).toEqual(DEFAULT_PIVOT);
  });

  it("ignores unknown keys silently", () => {
    // The unknown `foo` key is a non-xp.* param — should not affect parsing.
    expect(parsePivotState("?xp.measure=costComputed&foo=bar")).toEqual({
      ...DEFAULT_PIVOT,
      measure: "costComputed",
    });
    // Unknown `xp.*` keys are also silently ignored (parser doesn't crash,
    // it just doesn't produce a state field for them).
    expect(parsePivotState("?xp.foo=bar")).toEqual(DEFAULT_PIVOT);
  });

  it("falls back to defaults for unrecognized enum values", () => {
    expect(parsePivotState("?xp.measure=garbage&xp.grain=foo").measure).toBe(DEFAULT_PIVOT.measure);
    expect(parsePivotState("?xp.measure=garbage&xp.grain=foo").grain).toBe(DEFAULT_PIVOT.grain);
    expect(parsePivotState("?xp.chart=banana").chart).toBe(DEFAULT_PIVOT.chart);
    expect(parsePivotState("?xp.mode=banana").mode).toBe(DEFAULT_PIVOT.mode);
    expect(parsePivotState("?xp.entity=banana").entity).toBe(DEFAULT_PIVOT.entity);
  });

  it("parses a single non-default key with all other fields at defaults", () => {
    const state = parsePivotState("?xp.dim=project");
    expect(state).toEqual({ ...DEFAULT_PIVOT, dim: "project" });
    expect(state.measure).toBe(DEFAULT_PIVOT.measure);
    expect(state.chart).toBe(DEFAULT_PIVOT.chart);
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

  it("accepts time as a valid dimension (for drill-noop path)", () => {
    const state = parsePivotState("?xp.dim=time");
    expect(state.dim).toBe("time");
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

  it("round-trips a fully populated state", () => {
    const next: PivotState = {
      measure: "inputTokens",
      dim: "project",
      grain: "hour",
      chart: "area",
      mode: "distribution",
      entity: "turn",
      x: "totalTokens",
      y: "apiCalls",
      size: "wallMinutes",
    };
    const serialized = serializePivotState(next);
    const parsed = parsePivotState(`?${serialized}`);
    expect(parsed).toEqual(next);
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

  it("removes every prior xp.* key including unknowns", () => {
    const merged = mergePivotState("?xp.foo=bar&xp.baz=qux&xp.measure=costComputed&range=7d", {
      ...DEFAULT_PIVOT,
      measure: "inputTokens",
    });
    expect(merged).not.toContain("xp.foo");
    expect(merged).not.toContain("xp.baz");
    expect(merged).toContain("xp.measure=inputTokens");
    expect(merged).toContain("range=7d");
  });
});

describe("buildPivotQuery", () => {
  const filterShape = { range: { from: "2026-07-13T00:00:00Z", to: "2026-07-20T00:00:00Z" } };

  it("builds a SeriesMetricsQuery for chart=bar, mode=series (exact)", () => {
    const q = buildPivotQuery(DEFAULT_PIVOT, filterShape);
    expect(q).toEqual({
      mode: "series",
      measures: ["costComputed"],
      dimensions: ["time", "tool"], // grain-driven + breakdown
      grain: "day",
      range: filterShape.range,
    });
  });

  it("builds a SeriesMetricsQuery with only 'time' when dim=='time'", () => {
    const q = buildPivotQuery({ ...DEFAULT_PIVOT, dim: "time" }, filterShape);
    expect(q).toMatchObject({ dimensions: ["time"] });
  });

  it("builds a DistributionMetricsQuery when mode=distribution", () => {
    const q = buildPivotQuery({ ...DEFAULT_PIVOT, mode: "distribution" }, filterShape);
    expect(q).toEqual({
      mode: "distribution",
      measures: ["costComputed"],
      dimensions: ["time", "tool"],
      distributionEntity: "session",
      grain: "day",
      range: filterShape.range,
    });
  });

  it("builds a ScatterMetricsQuery when chart=scatter (exact, no size)", () => {
    const q = buildPivotQuery(
      { ...DEFAULT_PIVOT, chart: "scatter", x: "costComputed", y: "wallMinutes" },
      filterShape,
    );
    expect(q).toEqual({
      mode: "scatter",
      entity: "session",
      measures: ["costComputed", "wallMinutes"],
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
      dimensions: [],
      grain: "day",
      range: filterShape.range,
      filters: undefined,
      sessionPopulation: {},
    });
  });

  it("scatter query with size sets sizeMeasure and includes it in measures (exact)", () => {
    const q = buildPivotQuery(
      {
        ...DEFAULT_PIVOT,
        chart: "scatter",
        x: "costComputed",
        y: "wallMinutes",
        size: "apiCalls",
      },
      filterShape,
    );
    expect(q).toEqual({
      mode: "scatter",
      entity: "session",
      measures: ["costComputed", "wallMinutes", "apiCalls"],
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
      sizeMeasure: "apiCalls",
      dimensions: [],
      grain: "day",
      range: filterShape.range,
      filters: undefined,
      sessionPopulation: {},
    });
  });

  it("scatter query remaps gitBranch → branch in sessionPopulation", () => {
    const q = buildPivotQuery(
      {
        ...DEFAULT_PIVOT,
        chart: "scatter",
        x: "costComputed",
        y: "wallMinutes",
      },
      {
        range: filterShape.range,
        filters: {
          gitBranch: ["feat/48/explore-page"],
          project: ["claude-lens"],
        },
      },
    );
    // Narrow the union for the assertion (sessionPopulation is scatter-only).
    if (q.mode !== "scatter") throw new Error("expected scatter query");
    // Without the remap, gitBranch would be silently dropped at runtime.
    expect(q.sessionPopulation).toEqual({
      branch: ["feat/48/explore-page"],
      project: ["claude-lens"],
    });
  });

  it("scatter query does NOT include non-population dims (tool, time, etc.)", () => {
    const q = buildPivotQuery(
      { ...DEFAULT_PIVOT, chart: "scatter" },
      {
        range: filterShape.range,
        filters: {
          // tool/time/version/sidechain/gateStatus are not in SessionPopulationCriteria
          tool: ["Bash"],
          version: ["1.2.3"],
        },
      },
    );
    if (q.mode !== "scatter") throw new Error("expected scatter query");
    expect(q.sessionPopulation).toEqual({});
  });
});

describe("drill helpers", () => {
  it("buildSliceDrillSearch merges chip dims into the matching chip key", () => {
    const out = buildSliceDrillSearch("?range=7d", { dim: "project" }, "claude-lens");
    const params = new URLSearchParams(out);
    expect(params.get("range")).toBe("7d");
    expect(params.get("project")).toBe("claude-lens");
    expect(params.get("view")).toBe("page");
  });

  it("buildSliceDrillSearch dedupes existing chip values", () => {
    const out = buildSliceDrillSearch("?project=claude-lens", { dim: "project" }, "claude-lens");
    const params = new URLSearchParams(out);
    expect(params.get("project")).toBe("claude-lens");
  });

  it("buildSliceDrillSearch remaps gitBranch → branch key", () => {
    const out = buildSliceDrillSearch("", { dim: "gitBranch" }, "feat/48");
    const params = new URLSearchParams(out);
    expect(params.get("branch")).toBe("feat/48");
    expect(params.get("gitBranch")).toBeNull();
  });

  it("buildSliceDrillSearch falls back to slice.<dim> for non-chip dims", () => {
    const out = buildSliceDrillSearch("", { dim: "tool" }, "Bash");
    const params = new URLSearchParams(out);
    expect(params.get("slice.tool")).toBe("Bash");
  });

  it("buildScatterDrillPath builds /sessions/<id>", () => {
    expect(buildScatterDrillPath("abc-123", "")).toBe("/sessions/abc-123");
    expect(buildScatterDrillPath("abc-123", "?range=7d")).toBe("/sessions/abc-123?range=7d");
  });
});
