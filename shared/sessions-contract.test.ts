import { describe, expect, it } from "vitest";
import type {
  SessionListParams,
  SessionListItem,
  SessionListResponse,
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
