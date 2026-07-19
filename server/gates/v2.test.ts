import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import { evaluateV2 } from "./v2.js";
import { DEFAULT_GATE_THRESHOLDS } from "./thresholds.js";

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

function call(messageId: string, command: string, toolUseId: string): ApiCall {
  return {
    uuid: `u-${messageId}`,
    sessionId: "s1",
    messageId,
    timestamp: "2026-07-01T00:00:00.000Z",
    model: "claude-sonnet-5",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    isSidechain: false,
    tools: [
      { name: "Bash", inputBytes: 0, id: toolUseId, bashKind: "other", bashCommand: command },
    ],
    cwd: "/test",
    gitBranch: "",
    version: "",
    entrypoint: "",
  };
}

function toolResult(toolUseId: string, isError: boolean): ToolResultBytesRecord {
  return {
    sessionId: "s1",
    promptId: "p1",
    toolUseId,
    bytes: 100,
    isError,
  };
}

describe("V2 — Failing-command loop", () => {
  it("passes when a Bash command fails fewer times than v2Repeat", () => {
    const calls = [call("m1", "npm test", "tu1"), call("m2", "npm test", "tu2")];
    const records = [toolResult("tu1", true), toolResult("tu2", true)];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("fails when the same normalized command fails ≥ v2Repeat times (R10)", () => {
    const calls = [
      call("m1", "npm test", "tu1"),
      call("m2", "npm test", "tu2"),
      call("m3", "npm test", "tu3"),
    ];
    const records = [toolResult("tu1", true), toolResult("tu2", true), toolResult("tu3", true)];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.detail).toContain("npm test");
    expect(result.evidence[0]?.detail).toContain("3 times");
  });

  it("treats different commands with same failure as separate (no aggregate)", () => {
    const calls = [
      call("m1", "npm test", "tu1"),
      call("m2", "npm run lint", "tu2"),
      call("m3", "npm test", "tu3"),
    ];
    const records = [toolResult("tu1", true), toolResult("tu2", true), toolResult("tu3", true)];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.status).toBe("pass");
  });

  it("normalizes whitespace: 'npm test' and 'npm   test' are the same command (A9)", () => {
    const calls = [
      call("m1", "npm test", "tu1"),
      call("m2", "npm   test", "tu2"),
      call("m3", "  npm test  ", "tu3"),
    ];
    const records = [toolResult("tu1", true), toolResult("tu2", true), toolResult("tu3", true)];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(1);
  });

  it("skips successful Bash invocations entirely (only counts failures)", () => {
    const calls = [
      call("m1", "npm test", "tu1"),
      call("m2", "npm test", "tu2"),
      call("m3", "npm test", "tu3"),
    ];
    const records = [
      toolResult("tu1", true),
      toolResult("tu2", false), // success between failures
      toolResult("tu3", true),
    ];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.status).toBe("pass");
  });

  it("respects the threshold override (custom v2Repeat)", () => {
    const calls = [call("m1", "npm test", "tu1"), call("m2", "npm test", "tu2")];
    const records = [toolResult("tu1", true), toolResult("tu2", true)];
    // With v2Repeat=2, just two failures should fire.
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 2 });
    expect(result.status).toBe("fail");
  });

  it("uses the default threshold (3) from DEFAULT_GATE_THRESHOLDS", () => {
    expect(DEFAULT_GATE_THRESHOLDS.v2Repeat).toBe(3);
  });

  it("redacts a Bearer token embedded in a repeated failing command (review finding)", () => {
    const command = 'curl -H "Authorization: Bearer sk-live-abc123DEF456" https://api.example.com';
    const calls = [
      call("m1", command, "tu1"),
      call("m2", command, "tu2"),
      call("m3", command, "tu3"),
    ];
    const records = [toolResult("tu1", true), toolResult("tu2", true), toolResult("tu3", true)];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.detail).not.toContain("sk-live-abc123DEF456");
    expect(result.evidence[0]?.detail).toContain("***REDACTED***");
    // Grouping/dedup itself is unaffected by redaction — still one entry.
    expect(result.evidence).toHaveLength(1);
  });

  it("redacts a --password flag value in a repeated failing command", () => {
    const command = "mysql -u root --password=hunter2 -e 'select 1'";
    const calls = [
      call("m1", command, "tu1"),
      call("m2", command, "tu2"),
      call("m3", command, "tu3"),
    ];
    const records = [toolResult("tu1", true), toolResult("tu2", true), toolResult("tu3", true)];
    const result = evaluateV2([turn("p1", calls)], records, { v2Repeat: 3 });
    expect(result.evidence[0]?.detail).not.toContain("hunter2");
    expect(result.evidence[0]?.detail).toContain("***REDACTED***");
  });
});
