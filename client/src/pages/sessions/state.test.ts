import { describe, expect, it } from "vitest";
import {
  buildDistributionQuery,
  buildListQuery,
  buildScatterQuery,
  DEFAULT_SESSIONS_PAGE_STATE,
  parseSessionsPageState,
  resolveScatterPreset,
  scatterPresets,
  serializeSessionsPageState,
} from "./state.js";

const NOW = new Date("2026-07-15T00:00:00Z");

describe("parseSessionsPageState — defaults", () => {
  it("returns the canonical default state on an empty URL", () => {
    const state = parseSessionsPageState("");
    expect(state.sort).toBe(DEFAULT_SESSIONS_PAGE_STATE.sort);
    expect(state.order).toBe(DEFAULT_SESSIONS_PAGE_STATE.order);
    expect(state.offset).toBe(0);
    expect(state.browserView).toBe("table");
    expect(state.distributionView).toBe("histogram");
    expect(state.scatterPreset).toBe("cost-vs-duration");
    expect(state.compareIds).toEqual([]);
  });

  it("accepts a leading '?'", () => {
    const withQ = parseSessionsPageState("?sort=totalTokens");
    const withoutQ = parseSessionsPageState("sort=totalTokens");
    expect(withQ).toEqual(withoutQ);
  });
});

describe("parseSessionsPageState — every page-owned key", () => {
  it("decodes sort, order, offset, view", () => {
    const state = parseSessionsPageState("?sort=totalTokens&order=asc&offset=25&view=timeline");
    expect(state.sort).toBe("totalTokens");
    expect(state.order).toBe("asc");
    expect(state.offset).toBe(25);
    expect(state.browserView).toBe("timeline");
  });

  it("decodes cost bounds, entrypoint, and hasDrilldown", () => {
    const state = parseSessionsPageState(
      "?minCostComputed=0&maxCostComputed=5&entrypoint=cli,sdk&hasDrilldown=true",
    );
    expect(state.minCostComputed).toBe(0);
    expect(state.maxCostComputed).toBe(5);
    expect(state.entrypoint).toEqual(["cli", "sdk"]);
    expect(state.hasDrilldown).toBe(true);
  });

  it("decodes distribution view, scatter preset, scatter size", () => {
    const state = parseSessionsPageState(
      "?distView=percentiles&scatter=tokens-vs-turns&scatterSize=apiCalls",
    );
    expect(state.distributionView).toBe("percentiles");
    expect(state.scatterPreset).toBe("tokens-vs-turns");
    expect(state.scatterSize).toBe("apiCalls");
  });

  it("decodes compare IDs (CSV, unique, capped at 3)", () => {
    const state = parseSessionsPageState("?compare=a,b,c,d&compare=e");
    expect(state.compareIds).toEqual(["a", "b", "c"]);
  });

  it("decodes tags CSV (#P4-15)", () => {
    const state = parseSessionsPageState("?tags=important,follow-up");
    expect(state.tags).toEqual(["important", "follow-up"]);
  });

  it("leaves tags undefined when absent", () => {
    const state = parseSessionsPageState("");
    expect(state.tags).toBeUndefined();
  });
});

describe("parseSessionsPageState — malformed values fall back to defaults", () => {
  it("ignores unknown sort, order, view, distView, scatter", () => {
    const state = parseSessionsPageState(
      "?sort=garbage&order=sideways&view=flipbook&distView=numbers&scatter=impossible",
    );
    expect(state.sort).toBe(DEFAULT_SESSIONS_PAGE_STATE.sort);
    expect(state.order).toBe(DEFAULT_SESSIONS_PAGE_STATE.order);
    expect(state.browserView).toBe(DEFAULT_SESSIONS_PAGE_STATE.browserView);
    expect(state.distributionView).toBe(DEFAULT_SESSIONS_PAGE_STATE.distributionView);
    expect(state.scatterPreset).toBe(DEFAULT_SESSIONS_PAGE_STATE.scatterPreset);
  });

  it("drops contradictory cost bounds (min > max)", () => {
    const state = parseSessionsPageState("?minCostComputed=5&maxCostComputed=1");
    expect(state.minCostComputed).toBeUndefined();
    expect(state.maxCostComputed).toBeUndefined();
  });

  it("ignores non-positive cost bounds and non-integer offsets", () => {
    const state = parseSessionsPageState("?minCostComputed=-1&offset=foo&offset=-3");
    expect(state.minCostComputed).toBeUndefined();
    expect(state.offset).toBe(0);
  });

  it("ignores empty entrypoint and compare", () => {
    const state = parseSessionsPageState("?entrypoint=&compare=");
    expect(state.entrypoint).toBeUndefined();
    expect(state.compareIds).toEqual([]);
  });

  it("deduplicates compare IDs", () => {
    const state = parseSessionsPageState("?compare=a,b,a,c,b");
    expect(state.compareIds).toEqual(["a", "b", "c"]);
  });
});

describe("serializeSessionsPageState — round-trip", () => {
  it("round-trips a fully-populated state", () => {
    const state = {
      sort: "totalTokens" as const,
      order: "desc" as const,
      offset: 25,
      browserView: "timeline" as const,
      minCostComputed: 0,
      maxCostComputed: 5,
      entrypoint: ["cli", "sdk"],
      hasDrilldown: true,
      distributionView: "percentiles" as const,
      scatterPreset: "tokens-vs-turns" as const,
      scatterSize: "apiCalls" as const,
      compareIds: ["a", "b"],
      tags: ["follow-up", "important"],
    };
    const parsed = parseSessionsPageState(serializeSessionsPageState(state));
    expect(parsed).toEqual(state);
  });

  it("serializes defaults to an empty string (clean permalinks)", () => {
    expect(serializeSessionsPageState(DEFAULT_SESSIONS_PAGE_STATE)).toBe("");
  });

  it("omits the default range preset but emits custom ranges", () => {
    const custom = { ...DEFAULT_SESSIONS_PAGE_STATE, sort: "lastAt" as const };
    expect(serializeSessionsPageState(custom)).toBe("sort=lastAt");
  });

  it("always sorts chip arrays into canonical order", () => {
    const state = {
      ...DEFAULT_SESSIONS_PAGE_STATE,
      entrypoint: ["sdk", "cli"],
      compareIds: ["b", "a"],
    };
    const serialized = serializeSessionsPageState(state);
    expect(serialized).toContain("entrypoint=cli%2Csdk");
    expect(serialized).toContain("compare=a%2Cb");
  });
});

describe("buildListQuery — population parity", () => {
  it("builds one SessionPageParams for list, distribution, scatter", () => {
    // ARCH A2 single population: every section must resolve the same
    // session-population criteria from the canonical state + global filters.
    const filters = {
      range: { preset: "7d" as const },
      project: ["alpha"],
      model: ["claude-sonnet-5"],
      branch: [],
      host: [],
    };
    const state = {
      ...DEFAULT_SESSIONS_PAGE_STATE,
      minCostComputed: 0,
      maxCostComputed: 5,
      hasDrilldown: true,
      entrypoint: ["cli"],
      compareIds: ["s-a", "s-b"],
    };

    const listQuery = buildListQuery(state, filters, NOW);
    const distQuery = buildDistributionQuery(state, filters, NOW);
    const scatterQuery = buildScatterQuery(state, filters, NOW);

    // Range comes from the resolved global filter (presets → concrete ISO).
    expect(listQuery.from).toBe(distQuery.range.from);
    expect(listQuery.to).toBe(distQuery.range.to);

    // Page-only filters propagate.
    expect(listQuery.minCostComputed).toBe(0);
    expect(listQuery.maxCostComputed).toBe(5);
    expect(listQuery.hasDrilldown).toBe(true);
    expect(listQuery.entrypoint).toEqual(["cli"]);
    expect(listQuery.include).toBe("timeline");
    expect(listQuery.sessionId).toEqual(["s-a", "s-b"]);

    // Distribution + scatter share the same population.
    expect(distQuery.sessionPopulation).toEqual(scatterQuery.sessionPopulation);
    const pop = distQuery.sessionPopulation;
    expect(pop).toBeDefined();
    if (!pop) throw new Error("sessionPopulation should be defined for distribution query");
    expect(pop.project).toEqual(["alpha"]);
    expect(pop.model).toEqual(["claude-sonnet-5"]);
    expect(pop.entrypoint).toEqual(["cli"]);
  });
});

describe("scatterPresets — preset catalog", () => {
  it("exposes the documented three presets in a stable order", () => {
    const presets = scatterPresets();
    expect(presets.map((p) => p.id)).toEqual([
      "cost-vs-duration",
      "tokens-vs-turns",
      "cache-vs-cost",
    ]);
  });

  it("resolves preset ids to the expected measure triples", () => {
    expect(resolveScatterPreset("cost-vs-duration")).toEqual({
      xMeasure: "costComputed",
      yMeasure: "wallMinutes",
    });
    expect(resolveScatterPreset("tokens-vs-turns")).toEqual({
      xMeasure: "totalTokens",
      yMeasure: "turns",
    });
    expect(resolveScatterPreset("cache-vs-cost")).toEqual({
      xMeasure: "cacheHitPct",
      yMeasure: "costComputed",
    });
  });

  it("throws on an unknown preset id (forward-compat)", () => {
    expect(() => resolveScatterPreset("impossible" as never)).toThrow();
  });
});
