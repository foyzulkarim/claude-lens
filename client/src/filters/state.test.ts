import { describe, expect, it } from "vitest";
import {
  type FilterState,
  filtersToQuery,
  parseFilters,
  resolveRange,
  serializeFilters,
} from "./state.js";

describe("parseFilters — defaults & decoding", () => {
  it("defaults on empty query string", () => {
    expect(parseFilters("")).toEqual({
      range: { preset: "7d" },
      project: [],
      model: [],
      branch: [],
      host: [],
    });
  });

  it("decodes a range preset", () => {
    expect(parseFilters("?range=30d").range).toEqual({ preset: "30d" });
  });

  it("decodes a custom range", () => {
    expect(parseFilters("?from=2026-07-01&to=2026-07-10").range).toEqual({
      from: "2026-07-01",
      to: "2026-07-10",
    });
  });

  it("decodes CSV chip values", () => {
    expect(parseFilters("?project=a,b").project).toEqual(["a", "b"]);
  });
});

describe("parseFilters — malformed input falls back to defaults", () => {
  it("ignores unknown params and a garbage range value", () => {
    const result = parseFilters("?range=bogus&foo=bar");
    expect(result.range).toEqual({ preset: "7d" });
  });

  it("falls back on invalid custom range (from after to)", () => {
    expect(parseFilters("?from=2026-07-10&to=2026-07-01").range).toEqual({ preset: "7d" });
  });

  it("falls back on unparseable custom range dates", () => {
    expect(parseFilters("?from=not-a-date&to=2026-07-10").range).toEqual({ preset: "7d" });
  });
});

describe("serializeFilters — round-trip and clean URLs", () => {
  it("round-trips a fully-populated state", () => {
    const state: FilterState = {
      range: { from: "2026-07-01", to: "2026-07-10" },
      project: ["a", "b"],
      model: ["claude-sonnet-5"],
      branch: ["main"],
      host: ["default"],
    };
    expect(parseFilters(serializeFilters(state))).toEqual(state);
  });

  it("omits empty chips and the default range", () => {
    const defaultState: FilterState = {
      range: { preset: "7d" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    expect(serializeFilters(defaultState)).toBe("");
  });
});

describe("resolveRange — preset → concrete instants", () => {
  const now = new Date("2026-07-15T00:00:00Z");

  it("resolves 1d", () => {
    expect(resolveRange({ preset: "1d" }, now)).toEqual({
      from: "2026-07-14T00:00:00.000Z",
      to: "2026-07-15T00:00:00.000Z",
    });
  });

  it("resolves 7d", () => {
    expect(resolveRange({ preset: "7d" }, now)).toEqual({
      from: "2026-07-08T00:00:00.000Z",
      to: "2026-07-15T00:00:00.000Z",
    });
  });

  it("resolves 30d", () => {
    expect(resolveRange({ preset: "30d" }, now)).toEqual({
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-07-15T00:00:00.000Z",
    });
  });

  it("resolves 90d", () => {
    expect(resolveRange({ preset: "90d" }, now)).toEqual({
      from: "2026-04-16T00:00:00.000Z",
      to: "2026-07-15T00:00:00.000Z",
    });
  });

  it("passes a custom range through unchanged", () => {
    const custom = { from: "2026-07-01", to: "2026-07-10" };
    expect(resolveRange(custom, now)).toEqual(custom);
  });
});

describe("filtersToQuery — shaping for MetricsQuery", () => {
  const now = new Date("2026-07-15T00:00:00Z");

  it("remaps branch to gitBranch", () => {
    const state: FilterState = {
      range: { preset: "7d" },
      project: [],
      model: [],
      branch: ["main"],
      host: [],
    };
    const query = filtersToQuery(state, now);
    expect(query.filters?.gitBranch).toEqual(["main"]);
    expect(query.filters).not.toHaveProperty("branch");
  });

  it("drops empty-array chips", () => {
    const state: FilterState = {
      range: { preset: "7d" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    const query = filtersToQuery(state, now);
    expect(query.filters).toEqual({});
  });

  it("includes the resolved range", () => {
    const state: FilterState = {
      range: { preset: "1d" },
      project: [],
      model: [],
      branch: [],
      host: [],
    };
    const query = filtersToQuery(state, now);
    expect(query.range).toEqual(resolveRange(state.range, now));
  });

  it("keeps non-empty project/model/host filters", () => {
    const state: FilterState = {
      range: { preset: "7d" },
      project: ["claude-lens"],
      model: ["claude-sonnet-5"],
      branch: [],
      host: ["default"],
    };
    const query = filtersToQuery(state, now);
    expect(query.filters).toEqual({
      project: ["claude-lens"],
      model: ["claude-sonnet-5"],
      host: ["default"],
    });
  });
});
