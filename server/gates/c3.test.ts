import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import { evaluateC3 } from "./c3.js";

function turn(promptId: string, calls: ApiCall[]): Turn {
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: "2026-07-01T00:00:00.000Z",
    calls,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    toolResultBytes: 0,
  };
}

function call(
  messageId: string,
  timestamp: string,
  tools: { name: string; id: string }[],
): ApiCall {
  return {
    uuid: `u-${messageId}`,
    sessionId: "s1",
    messageId,
    timestamp,
    model: "claude-sonnet-5",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    isSidechain: false,
    tools: tools.map((t) => ({ name: t.name, inputBytes: 0, id: t.id })),
    cwd: "/test",
    gitBranch: "",
    version: "",
    entrypoint: "",
  };
}

function toolResult(toolUseId: string, bytes: number, isSidechain = false): ToolResultBytesRecord {
  return {
    sessionId: "s1",
    promptId: "p1",
    toolUseId,
    bytes,
    isError: false,
    isSidechain,
  };
}

describe("C3 — Fat tool result", () => {
  it("passes when tool_result content is at or below c3MaxChars (strict >)", () => {
    const calls = [call("m1", "2026-07-01T00:00:00.000Z", [{ name: "Read", id: "tu1" }])];
    const records = [toolResult("tu1", 15_000)];
    const result = evaluateC3([turn("p1", calls)], calls, calls, records, records, {
      c3MaxChars: 15_000,
    });
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("warns when tool_result content exceeds c3MaxChars", () => {
    const calls = [call("m1", "2026-07-01T00:00:00.000Z", [{ name: "Read", id: "tu1" }])];
    const records = [toolResult("tu1", 16_000)];
    const result = evaluateC3([turn("p1", calls)], calls, calls, records, records, {
      c3MaxChars: 15_000,
    });
    expect(result.status).toBe("warn");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.detail).toContain("Read");
    expect(result.evidence[0]?.detail).toContain("16000");
  });

  it("evidence includes the recurring-cost estimate (size/4 × remaining calls) per R12", () => {
    const fatCall = call("m1", "2026-07-01T00:00:00.000Z", [{ name: "Read", id: "tu1" }]);
    const laterCall1 = call("m2", "2026-07-01T00:00:01.000Z", [{ name: "Bash", id: "tu2" }]);
    const laterCall2 = call("m3", "2026-07-01T00:00:02.000Z", [{ name: "Bash", id: "tu3" }]);
    const calls = [fatCall, laterCall1, laterCall2];
    const records = [toolResult("tu1", 20_000)];
    const result = evaluateC3([turn("p1", calls)], calls, calls, records, records, {
      c3MaxChars: 15_000,
    });
    expect(result.status).toBe("warn");
    // size/4 = 5000 tokens; remaining = 2 → 10000 token-equivalents
    expect(result.evidence[0]?.detail).toContain("5000 tokens");
    expect(result.evidence[0]?.detail).toContain("2 remaining");
    expect(result.evidence[0]?.detail).toContain("10000 token-equivalents");
  });

  it("counts sidechain calls in the 'remaining calls' denominator (ARCH A7)", () => {
    const fatCall = call("m1", "2026-07-01T00:00:00.000Z", [{ name: "Read", id: "tu1" }]);
    const sidechainCall: ApiCall = {
      ...call("m2", "2026-07-01T00:00:01.000Z", [{ name: "Bash", id: "tu2" }]),
      isSidechain: true,
      agentId: "agent-x",
    };
    const mainAfterCall = call("m3", "2026-07-01T00:00:02.000Z", [{ name: "Bash", id: "tu3" }]);
    const allCalls = [fatCall, sidechainCall, mainAfterCall];
    const records = [toolResult("tu1", 16_000)];
    const result = evaluateC3([turn("p1", [fatCall])], [fatCall], allCalls, records, records, {
      c3MaxChars: 15_000,
    });
    // Sidechain call after this Read + main call after = 2 remaining.
    expect(result.evidence[0]?.detail).toContain("2 remaining");
  });

  it("skips sidechain tool_result records themselves (gates.md §Shared preprocessing)", () => {
    const calls = [call("m1", "2026-07-01T00:00:00.000Z", [{ name: "Read", id: "tu1" }])];
    const records = [
      toolResult("tu1", 16_000, false), // main, fat
      toolResult("tu2", 50_000, true), // sidechain, fat — should be skipped
    ];
    const result = evaluateC3([turn("p1", calls)], calls, calls, records, records, {
      c3MaxChars: 15_000,
    });
    // Only the main-chain fat result surfaces — the sidechain one is skipped.
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.detail).toContain("16000");
  });
});
