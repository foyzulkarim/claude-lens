import { describe, expect, it } from "vitest";
import type { ApiCall, TokenUsage, Turn } from "../../shared/types.js";
import { aggregateLogicalTurnCost, groupLogicalTurns } from "./logical-turns.js";

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    ...overrides,
  };
}

function call(messageId: string, timestamp: string, overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `uuid-${messageId}`,
    sessionId: "s1",
    messageId,
    timestamp,
    model: "claude-sonnet-5",
    usage: usage(),
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function turn(
  promptId: string,
  isSidechain: boolean,
  calls: ApiCall[],
  overrides: Partial<Turn> = {},
): Turn {
  const startedAt = calls[0]?.timestamp ?? "";
  const endedAt = calls[calls.length - 1]?.timestamp ?? startedAt;
  return {
    promptId,
    sessionId: "s1",
    isSidechain,
    startedAt,
    endedAt,
    calls,
    usage: usage(),
    toolResultBytes: 0,
    ...overrides,
  };
}

const PRICER: (u: TokenUsage, model: string) => number = (u) => u.inputTokens + u.outputTokens;

describe("groupLogicalTurns — main/sidechain grouping", () => {
  it("emits an empty list for empty input", () => {
    expect(groupLogicalTurns([])).toEqual([]);
  });

  it("groups main + sidechain segments that share a promptId into one logical turn", () => {
    const main = turn(
      "p1",
      false,
      [
        call("msg_a", "2026-07-03T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) }),
        call("msg_b", "2026-07-03T10:00:05.000Z", { usage: usage({ inputTokens: 50 }) }),
      ],
      { promptText: "fix the bug" },
    );
    const side = turn("p1", true, [
      call("msg_s1", "2026-07-03T10:00:02.000Z", { usage: usage({ inputTokens: 30 }) }),
    ]);

    const result = groupLogicalTurns([main, side]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      turnNumber: 1,
      promptId: "p1",
      promptText: "fix the bug",
      main,
      sidechains: [side],
    });
    expect(result[0]?.startedAt).toBe("2026-07-03T10:00:00.000Z");
    expect(result[0]?.endedAt).toBe("2026-07-03T10:00:05.000Z");
  });

  it("numbers multiple logical turns chronologically by first sighting", () => {
    const a = turn("p1", false, [call("m1", "2026-07-03T10:00:00.000Z")], {
      promptText: "first",
    });
    const b = turn("p2", false, [call("m2", "2026-07-03T10:01:00.000Z")], {
      promptText: "second",
    });
    const c = turn("p3", false, [call("m3", "2026-07-03T10:02:00.000Z")], {
      promptText: "third",
    });

    const result = groupLogicalTurns([a, b, c]);

    expect(result.map((t) => t.turnNumber)).toEqual([1, 2, 3]);
    expect(result.map((t) => t.promptText)).toEqual(["first", "second", "third"]);
  });

  it("treats a sidechain-only turn as a logical turn with main undefined", () => {
    const side = turn("p1", true, [call("m_s1", "2026-07-03T10:00:00.000Z")]);

    const result = groupLogicalTurns([side]);

    expect(result).toHaveLength(1);
    expect(result[0]?.main).toBeUndefined();
    expect(result[0]?.sidechains).toEqual([side]);
  });

  it("keeps sidechain attribution isolated — multiple sidechain segments share the promptId", () => {
    const sideA = turn("p1", true, [call("m_s1", "2026-07-03T10:00:01.000Z")]);
    const sideB = turn("p1", true, [call("m_s2", "2026-07-03T10:00:02.000Z")]);
    const main = turn("p1", false, [call("m1", "2026-07-03T10:00:00.000Z")], {
      promptText: "do thing",
    });

    const result = groupLogicalTurns([sideA, sideB, main]);

    expect(result).toHaveLength(1);
    expect(result[0]?.sidechains).toEqual([sideA, sideB]);
    expect(result[0]?.main).toBe(main);
  });
});

describe("aggregateLogicalTurnCost", () => {
  it("sums cost across main + all sidechain segments exactly once", () => {
    const main = turn("p1", false, [
      call("m1", "2026-07-03T10:00:00.000Z", { usage: usage({ inputTokens: 100 }) }),
    ]);
    const side = turn("p1", true, [
      call("m_s1", "2026-07-03T10:00:01.000Z", { usage: usage({ inputTokens: 40 }) }),
    ]);
    const result = groupLogicalTurns([main, side]);

    expect(result).toHaveLength(1);
    expect(aggregateLogicalTurnCost(result[0], PRICER)).toBe(140);
  });

  it("returns 0 for a logical turn with no calls (sidechain-only, empty)", () => {
    const side = turn("p1", true, []);
    const result = groupLogicalTurns([side]);

    expect(aggregateLogicalTurnCost(result[0], PRICER)).toBe(0);
  });

  it("matches the per-turn sum across every segment", () => {
    const main = turn("p1", false, [
      call("m1", "2026-07-03T10:00:00.000Z", {
        usage: usage({ inputTokens: 10, outputTokens: 5 }),
      }),
      call("m2", "2026-07-03T10:00:01.000Z", {
        usage: usage({ inputTokens: 20, outputTokens: 5 }),
      }),
    ]);
    const side = turn("p1", true, [
      call("m_s1", "2026-07-03T10:00:02.000Z", {
        usage: usage({ inputTokens: 30, outputTokens: 0 }),
      }),
    ]);
    const result = groupLogicalTurns([main, side]);
    // 15 + 25 + 30 = 70
    expect(aggregateLogicalTurnCost(result[0], PRICER)).toBe(70);
  });
});
