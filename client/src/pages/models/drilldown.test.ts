import { describe, expect, it } from "vitest";
import type { FilterState } from "../../filters/state.js";
import { entrypointHref, modelHref } from "./drilldown.js";

const emptyFilters: FilterState = {
  range: { preset: "7d" },
  project: [],
  model: [],
  branch: [],
  host: [],
};

const populatedFilters: FilterState = {
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-18T00:00:00.000Z" },
  project: ["claude-lens"],
  model: ["claude-fable-5"],
  branch: ["main"],
  host: [],
};

describe("drilldown — modelHref", () => {
  it("builds a /sessions URL with just the model when filters are empty", () => {
    expect(modelHref("claude-fable-5", emptyFilters)).toBe("/sessions?model=claude-fable-5");
  });

  it("preserves sibling filters and replaces the existing model chip", () => {
    const href = modelHref("claude-opus-4-8", populatedFilters);
    expect(href.startsWith("/sessions?")).toBe(true);
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("model")).toBe("claude-opus-4-8");
    expect(params.get("project")).toBe("claude-lens");
    expect(params.get("branch")).toBe("main");
    expect(params.get("from")).toBe("2026-07-01T00:00:00.000Z");
    expect(params.get("to")).toBe("2026-07-18T00:00:00.000Z");
  });

  it("preserves a non-default range preset", () => {
    const filters: FilterState = { ...emptyFilters, range: { preset: "30d" } };
    expect(modelHref("claude-sonnet-5", filters)).toBe("/sessions?range=30d&model=claude-sonnet-5");
  });

  it("drops the default '7d' preset (canonical URL form)", () => {
    expect(modelHref("claude-fable-5", emptyFilters)).not.toContain("range=");
  });

  it("percent-encodes unsafe characters", () => {
    expect(modelHref("claude foo,bar", emptyFilters)).toBe("/sessions?model=claude%20foo%2Cbar");
  });
});

describe("drilldown — entrypointHref", () => {
  it("drills to /sessions with the entrypoint chip", () => {
    expect(entrypointHref("cli", emptyFilters)).toBe("/sessions?entrypoint=cli");
  });

  it("preserves sibling filters and the date range", () => {
    const href = entrypointHref("ide", populatedFilters);
    const params = new URLSearchParams(href.slice("/sessions?".length));
    expect(params.get("entrypoint")).toBe("ide");
    expect(params.get("project")).toBe("claude-lens");
    expect(params.get("from")).toBe("2026-07-01T00:00:00.000Z");
  });
});
