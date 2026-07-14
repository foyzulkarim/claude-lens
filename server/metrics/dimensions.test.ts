import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import { callDimensionValue, matchesFilter, turnDimensionValue } from "./dimensions.js";

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: "u1",
    sessionId: "s1",
    messageId: "m1",
    timestamp: "2026-07-14T10:00:00.000Z",
    model: "claude-sonnet-5",
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    promptId: "p1",
    sessionId: "s1",
    isSidechain: false,
    startedAt: "2026-07-14T10:00:00.000Z",
    endedAt: "2026-07-14T10:01:00.000Z",
    calls: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
    ...overrides,
  };
}

describe("callDimensionValue — scalar dimensions", () => {
  it("extracts project from cwd", () => {
    expect(callDimensionValue(call({ cwd: "/repo/beta" }), "project")).toBe("/repo/beta");
  });

  it("extracts model, gitBranch, version, entrypoint directly", () => {
    const c = call({
      model: "claude-fable-5",
      gitBranch: "feat/x",
      version: "2.0.0",
      entrypoint: "ide",
    });
    expect(callDimensionValue(c, "model")).toBe("claude-fable-5");
    expect(callDimensionValue(c, "gitBranch")).toBe("feat/x");
    expect(callDimensionValue(c, "version")).toBe("2.0.0");
    expect(callDimensionValue(c, "entrypoint")).toBe("ide");
  });

  it("extracts sidechain as main/sidechain label", () => {
    expect(callDimensionValue(call({ isSidechain: true }), "sidechain")).toBe("sidechain");
    expect(callDimensionValue(call({ isSidechain: false }), "sidechain")).toBe("main");
  });

  it("host always returns the constant default (no real data source yet)", () => {
    expect(callDimensionValue(call(), "host")).toBe("default");
  });
});

describe("callDimensionValue — tool (multi-valued)", () => {
  it("returns distinct tool names used in the call", () => {
    const c = call({
      tools: [
        { name: "Read", inputBytes: 10 },
        { name: "Bash", inputBytes: 20 },
      ],
    });
    expect(callDimensionValue(c, "tool")).toEqual(["Read", "Bash"]);
  });

  it("dedupes repeated use of the same tool within one call", () => {
    const c = call({
      tools: [
        { name: "Read", inputBytes: 10 },
        { name: "Read", inputBytes: 15 },
      ],
    });
    expect(callDimensionValue(c, "tool")).toEqual(["Read"]);
  });

  it("a call with no tool_use blocks contributes to no tool bucket", () => {
    expect(callDimensionValue(call({ tools: [] }), "tool")).toEqual([]);
  });
});

describe("turnDimensionValue — gateStatus", () => {
  it("extracts gateStatus when set", () => {
    expect(turnDimensionValue(turn({ gateStatus: "pass" }), "gateStatus")).toBe("pass");
  });

  it("returns unknown when gateStatus is absent (today's reality)", () => {
    expect(turnDimensionValue(turn({ gateStatus: undefined }), "gateStatus")).toBe("unknown");
  });

  it("returns unknown for an empty-string gateStatus too, not just a missing one", () => {
    expect(turnDimensionValue(turn({ gateStatus: "" }), "gateStatus")).toBe("unknown");
  });
});

describe("callDimensionValue — missing/malformed scalar values", () => {
  it("an empty-string field buckets as unknown", () => {
    expect(callDimensionValue(call({ gitBranch: "" }), "gitBranch")).toBe("unknown");
  });
});

describe("matchesFilter", () => {
  it("matches/does not match a single scalar value against an allowed list", () => {
    expect(matchesFilter("claude-sonnet-5", ["claude-sonnet-5", "claude-fable-5"])).toBe(true);
    expect(matchesFilter("claude-opus-4-8", ["claude-sonnet-5", "claude-fable-5"])).toBe(false);
  });

  it("matches a multi-value (tool) result on any intersection", () => {
    expect(matchesFilter(["Read", "Bash"], ["Bash"])).toBe(true);
    expect(matchesFilter(["Read", "Bash"], ["Write"])).toBe(false);
  });

  it("passes through when no filter is configured for a dimension", () => {
    expect(matchesFilter("anything", undefined)).toBe(true);
    expect(matchesFilter(["a", "b"], undefined)).toBe(true);
  });

  it("coerces numeric allowed-list entries to strings before comparing", () => {
    expect(matchesFilter("5", [5, 6])).toBe(true);
    expect(matchesFilter("7", [5, 6])).toBe(false);
  });

  it("an explicit empty allowed list matches nothing, unlike undefined", () => {
    expect(matchesFilter("anything", [])).toBe(false);
    expect(matchesFilter(["a", "b"], [])).toBe(false);
  });
});
