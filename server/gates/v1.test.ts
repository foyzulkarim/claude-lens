import { describe, expect, it } from "vitest";
import type { ApiCall, Turn } from "../../shared/types.js";
import { evaluateV1 } from "./v1.js";

/** Build a turn with the given tool_use calls (main-chain, promptId-tagged). */
function turn(promptId: string, calls: ApiCall[]): Turn {
  const startedAt = calls[0]?.timestamp ?? "2026-07-01T00:00:00.000Z";
  const endedAt = calls[calls.length - 1]?.timestamp ?? startedAt;
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    startedAt,
    endedAt,
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

/** Build a minimal ApiCall with the given tool_use blocks. */
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

describe("V1 — Edit-without-verify", () => {
  it("passes when a turn has Edit followed by Bash", () => {
    const result = evaluateV1([
      turn("p1", [
        call("m1", [{ name: "Edit", targetPath: "/a.ts" }]),
        call("m2", [{ name: "Bash" }]),
      ]),
    ]);
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("passes when a turn has no edits (N/A, excluded from denominator)", () => {
    const result = evaluateV1([
      turn("p1", [call("m1", [{ name: "Bash" }])]),
      turn("p2", [call("m2", [{ name: "Read", targetPath: "/a.ts" }])]),
    ]);
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual([]);
  });

  it("fails when a non-final turn has Edit with no Bash after", () => {
    const result = evaluateV1([
      turn("p1", [call("m1", [{ name: "Edit", targetPath: "/a.ts" }])]),
      turn("p2", [call("m2", [{ name: "Bash" }])]),
    ]);
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.turnN).toBe(1);
    expect(result.evidence[0]?.filePath).toBe("/a.ts");
    expect(result.evidence[0]?.callId).toBe("m1");
  });

  it("uses softer final-turn framing: only final turn failing → warn (R9)", () => {
    const result = evaluateV1([
      turn("p1", [
        call("m1", [{ name: "Edit", targetPath: "/a.ts" }]),
        call("m2", [{ name: "Bash" }]),
      ]),
      turn("p2", [call("m3", [{ name: "Edit", targetPath: "/b.ts" }])]),
    ]);
    expect(result.status).toBe("warn");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.turnN).toBe(2);
    expect(result.evidence[0]?.filePath).toBe("/b.ts");
  });

  it("counts Write as an Edit for the V1 rule (gates.md §V1)", () => {
    const result = evaluateV1([
      // Mid-session turn: Write with no Bash after → fail.
      turn("p1", [call("m1", [{ name: "Write", targetPath: "/new.ts" }])]),
      // Final turn has Read only → N/A.
      turn("p2", [call("m2", [{ name: "Read", targetPath: "/x.ts" }])]),
    ]);
    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.filePath).toBe("/new.ts");
  });

  it("emits one evidence entry per failing turn (multiple non-final failures)", () => {
    const result = evaluateV1([
      turn("p1", [call("m1", [{ name: "Edit", targetPath: "/a.ts" }])]),
      turn("p2", [call("m2", [{ name: "Edit", targetPath: "/b.ts" }])]),
      turn("p3", [call("m3", [{ name: "Bash" }])]),
    ]);
    expect(result.status).toBe("fail");
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence.map((e) => e.turnN)).toEqual([1, 2]);
  });
});
