import { describe, expect, it } from "vitest";
import type {
  SessionListItem,
  SessionListParams,
  SessionListResponse,
  SessionPageItem,
  SessionPageParams,
  SessionPageResponse,
  SessionPopulationCriteria,
  SessionPopulationFilter,
  SessionTimelineSet,
  TracePoint,
} from "./sessions-contract.js";

describe("SessionListParams", () => {
  it("all query param fields are optional", () => {
    const empty: SessionListParams = {};
    expect(empty).toEqual({});

    const full: SessionListParams = {
      sort: "costComputed",
      order: "desc",
      offset: 10,
      limit: 50,
      from: "2024-01-01T00:00:00Z",
      to: "2024-12-31T23:59:59Z",
      project: ["my-project"],
      model: ["gpt-4o"],
      branch: ["main"],
      host: ["local"],
      include: "trace",
    };
    expect(full.sort).toBe("costComputed");
    expect(full.include).toBe("trace");
  });

  it("accepts valid sort values", () => {
    const sorts: SessionListParams["sort"][] = [
      "lastAt",
      "costComputed",
      "durationMs",
      "cacheSavingsComputed",
      "maxTurnCostComputed",
    ];
    for (const s of sorts) {
      expect(s).toBeTypeOf("string");
    }
  });

  it("accepts valid order values", () => {
    const orders: SessionListParams["order"][] = ["asc", "desc"];
    for (const o of orders) {
      expect(o).toBeTypeOf("string");
    }
  });
});

describe("SessionListItem", () => {
  it("required fields present", () => {
    const item: SessionListItem = {
      sessionId: "sess-001",
      startedAt: "2024-01-01T10:00:00Z",
      lastAt: "2024-01-01T10:30:00Z",
      project: "my-project",
      model: "gpt-4o",
      durationMs: 1800000,
      turnCount: 5,
      costComputed: 0.15,
    };
    expect(item.sessionId).toBe("sess-001");
    expect(item.costComputed).toBe(0.15);
  });

  it("optional fields default to undefined", () => {
    const item: SessionListItem = {
      sessionId: "sess-001",
      startedAt: "2024-01-01T10:00:00Z",
      lastAt: "2024-01-01T10:30:00Z",
      project: "my-project",
      model: "gpt-4o",
      durationMs: 0,
      turnCount: 0,
      costComputed: 0,
    };
    expect(item.branch).toBeUndefined();
    expect(item.host).toBeUndefined();
    expect(item.cacheSavingsComputed).toBeUndefined();
    expect(item.maxTurnCostComputed).toBeUndefined();
    expect(item.contextPctEstimated).toBeUndefined();
    expect(item.trace).toBeUndefined();
  });

  it("trace is optional and can be populated", () => {
    const trace: TracePoint[] = [
      { turnIndex: 0, cost: 0.05, timestamp: "2024-01-01T10:00:00Z" },
      { turnIndex: 1, cost: 0.03, timestamp: "2024-01-01T10:05:00Z" },
    ];
    const item: SessionListItem = {
      sessionId: "sess-001",
      startedAt: "2024-01-01T10:00:00Z",
      lastAt: "2024-01-01T10:10:00Z",
      project: "my-project",
      model: "gpt-4o",
      durationMs: 0,
      turnCount: 2,
      costComputed: 0.08,
      trace,
    };
    expect(item.trace).toHaveLength(2);
    expect(item.trace?.[0].turnIndex).toBe(0);
  });
});

describe("SessionListResponse", () => {
  it("has items + total + meta", () => {
    const response: SessionListResponse = {
      items: [],
      total: 0,
      meta: {
        matchedExtent: null,
        globalCapture: {
          hasCostSamples: true,
          hasTurnBoundaries: true,
          hasCostLog: false,
          costBasis: "computed",
        },
      },
    };
    expect(response).toHaveProperty("items");
    expect(response).toHaveProperty("total");
    expect(response).toHaveProperty("meta");
    expect(Array.isArray(response.items)).toBe(true);
    expect(typeof response.total).toBe("number");
    expect(response.meta.matchedExtent).toBeNull();
  });

  it("matchedExtent can be populated", () => {
    const response: SessionListResponse = {
      items: [],
      total: 100,
      meta: {
        matchedExtent: { from: "2024-01-01", to: "2024-12-31" },
        globalCapture: {
          hasCostSamples: true,
          hasTurnBoundaries: true,
          hasCostLog: true,
          costBasis: "observed",
        },
      },
    };
    expect(response.meta.matchedExtent?.from).toBe("2024-01-01");
    expect(response.meta.matchedExtent?.to).toBe("2024-12-31");
  });
});

// ---------------------------------------------------------------------------
// Page projection (#P4-4 / ARCH-sessions-page T1) — keeps the existing
// compact contract compatible while adding the strict page vocabulary.
// ---------------------------------------------------------------------------

describe("SessionPopulationFilter — canonical server model", () => {
  it("accepts every documented field", () => {
    const filter: SessionPopulationFilter = {
      range: { from: "2026-07-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
      project: ["alpha"],
      model: ["claude-sonnet-5"],
      branch: ["main"],
      host: ["default"],
      entrypoint: ["cli"],
      minCostComputed: 0,
      maxCostComputed: 10,
      gateStatus: ["pass"],
      hasDrilldown: true,
      sessionId: ["s-1", "s-2"],
    };
    expect(filter.range.from).toBe("2026-07-01T00:00:00Z");
    expect(filter.sessionId).toHaveLength(2);
  });

  it("SessionPopulationCriteria omits the range", () => {
    // Compile-time check: SessionPopulationCriteria is `Omit<…, "range">`.
    // The assertion below assigns `criteria.range = ...` from a literal
    // `undefined`, which TypeScript rejects unless `range` truly is not a
    // key — exactly what `Omit<…, "range">` gives us.
    const criteria: SessionPopulationCriteria = {
      project: ["alpha"],
      hasDrilldown: true,
    };
    expect(criteria.project).toEqual(["alpha"]);
    expect((criteria as { range?: unknown }).range).toBeUndefined();
  });
});

describe("SessionPageParams — wider sort union", () => {
  it("accepts every documented sort key", () => {
    const sorts: NonNullable<SessionPageParams["sort"]>[] = [
      "lastAt",
      "costComputed",
      "costObserved",
      "durationMs",
      "totalTokens",
      "turnCount",
      "cacheHitPct",
      "cacheSavingsComputed",
      "maxTurnCostComputed",
      "gateScore",
      "branch",
      "version",
    ];
    expect(sorts).toHaveLength(12);
    for (const s of sorts) {
      expect(s).toBeTypeOf("string");
    }
  });

  it("requires view=page and supports page-only filters", () => {
    const params: SessionPageParams = {
      view: "page",
      sort: "totalTokens",
      order: "desc",
      offset: 0,
      limit: 25,
      from: "2026-07-01",
      to: "2026-08-01",
      project: ["alpha"],
      model: ["claude-sonnet-5"],
      branch: ["main"],
      host: ["default"],
      entrypoint: ["cli"],
      minCostComputed: 0,
      maxCostComputed: 5,
      hasDrilldown: true,
      include: "timeline",
      sessionId: ["s-1"],
    };
    expect(params.view).toBe("page");
    expect(params.include).toBe("timeline");
  });
});

describe("SessionPageItem — strict page-row projection", () => {
  it("required transcript-tier fields are mandatory", () => {
    const item: SessionPageItem = {
      sessionId: "s1",
      startedAt: "2026-07-01T00:00:00Z",
      lastAt: "2026-07-01T00:05:00Z",
      project: "alpha",
      models: ["claude-sonnet-5", "claude-fable-5"],
      host: "default",
      entrypoint: "cli",
      version: "1.2.3",
      durationMs: 300_000,
      turnCount: 4,
      totalTokens: 12_345,
      cacheHitPct: 0.42,
      costComputed: 1.25,
      hasDrilldown: true,
      tier: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
    };
    expect(item.models).toHaveLength(2);
    expect(item.hasDrilldown).toBe(true);
  });

  it("optional premium/gate/tag fields default to undefined", () => {
    const item: SessionPageItem = {
      sessionId: "s1",
      startedAt: "2026-07-01T00:00:00Z",
      lastAt: "2026-07-01T00:05:00Z",
      project: "alpha",
      models: ["claude-sonnet-5"],
      host: "default",
      entrypoint: "cli",
      version: "1.2.3",
      durationMs: 0,
      turnCount: 0,
      totalTokens: 0,
      cacheHitPct: 0,
      costComputed: 0,
      hasDrilldown: false,
      tier: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
    };
    expect(item.costObserved).toBeUndefined();
    expect(item.linesAdded).toBeUndefined();
    expect(item.linesRemoved).toBeUndefined();
    expect(item.contextPctEstimated).toBeUndefined();
    expect(item.contextPctObserved).toBeUndefined();
    expect(item.gateScore).toBeUndefined();
    expect(item.gateStatus).toBeUndefined();
    expect(item.tags).toBeUndefined();
  });
});

describe("SessionTimelineSet — bounded visual points", () => {
  it("carries matched/eligible/returned/sampled metadata", () => {
    const set: SessionTimelineSet = {
      items: [
        {
          sessionId: "s1",
          project: "alpha",
          startedAt: "2026-07-01T00:00:00Z",
          lastAt: "2026-07-01T00:05:00Z",
          costComputed: 1.25,
        },
      ],
      matched: 50,
      eligible: 48,
      returned: 48,
      sampled: false,
      excludedInvalidTime: 2,
    };
    expect(set.sampled).toBe(false);
    expect(set.excludedInvalidTime).toBe(2);
  });
});

describe("SessionPageResponse — page projection root", () => {
  it("items + total + meta are required; timeline is optional", () => {
    const response: SessionPageResponse = {
      items: [],
      total: 0,
      meta: {
        matched: 0,
        matchedExtent: null,
        globalCapture: {
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
          costBasis: "computed",
        },
      },
    };
    expect(response.timeline).toBeUndefined();
  });
});
