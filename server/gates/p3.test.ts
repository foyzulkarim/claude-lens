import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import { evaluateP3 } from "./p3.js";

function turn(promptId: string, promptText: string, calls: ApiCall[]): Turn {
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    promptText,
    promptSource: "typed",
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

function call(messageId: string, tools: { name: string; targetPath?: string }[]): ApiCall {
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
    tools: tools.map((t) => ({
      name: t.name,
      inputBytes: 0,
      targetPath: t.targetPath,
    })),
    cwd: "/test",
    gitBranch: "",
    version: "",
    entrypoint: "",
  };
}

describe("P3 — Code-before-read", () => {
  it("fails when Edit is called on a file with no prior Read", () => {
    const result = evaluateP3([
      turn("p1", "Edit /Users/demo/foo.ts", [
        call("m1", [{ name: "Edit", targetPath: "/Users/demo/foo.ts" }]),
      ]),
    ]);
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.filePath).toBe("/Users/demo/foo.ts");
  });

  it("passes when Edit is on a previously-Read file", () => {
    const result = evaluateP3([
      turn("p1", "Read /Users/demo/foo.ts", [
        call("m1", [{ name: "Read", targetPath: "/Users/demo/foo.ts" }]),
      ]),
      turn("p2", "Now edit it", [call("m2", [{ name: "Edit", targetPath: "/Users/demo/foo.ts" }])]),
    ]);
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("treats an @-mention of the path in a prior prompt as a read (R11)", () => {
    const result = evaluateP3([
      turn("p1", "Look at @/Users/demo/foo.ts please and tell me what you think", [
        call("m1", [{ name: "Bash" }]),
      ]),
      turn("p2", "Now edit it", [call("m2", [{ name: "Edit", targetPath: "/Users/demo/foo.ts" }])]),
    ]);
    expect(result.status).toBe("pass");
  });

  it("does NOT fail on a Write without prior Read (creation-style, N/A)", () => {
    const result = evaluateP3([
      turn("p1", "Create the file", [
        call("m1", [{ name: "Write", targetPath: "/Users/demo/new.ts" }]),
      ]),
    ]);
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("emits one evidence entry per offending file (dedup)", () => {
    const result = evaluateP3([
      turn("p1", "Edit foo", [
        call("m1", [{ name: "Edit", targetPath: "/Users/demo/foo.ts" }]),
        call("m2", [{ name: "Edit", targetPath: "/Users/demo/foo.ts" }]),
      ]),
    ]);
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(1);
  });

  it("does not match @-mention in the SAME turn (only prior)", () => {
    const result = evaluateP3([
      turn("p1", "Look at @/Users/demo/foo.ts please — now edit it", [
        call("m1", [{ name: "Edit", targetPath: "/Users/demo/foo.ts" }]),
      ]),
    ]);
    // Prompt mentions the path, but the @-mention check is over PRIOR turns,
    // not the same turn. The Edit here has no prior Read.
    expect(result.status).toBe("fail");
  });
});
