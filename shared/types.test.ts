import { describe, expect, it } from "vitest";
import type { Session, Turn } from "./types.js";

describe("Session — additive optional fields", () => {
  it("cacheSavingsComputed defaults to undefined", () => {
    const session: Session = {
      sessionId: "sess-001",
      lineageId: "lin-001",
      project: "test",
      entrypoint: "/test",
      models: ["gpt-4o"],
      gitBranch: "main",
      version: "0.0.0",
      host: "default",
      tier: {
        hasCostSamples: true,
        hasTurnBoundaries: true,
        hasCostLog: false,
        costBasis: "computed",
      },
      firstAt: "2024-01-01T00:00:00Z",
      lastAt: "2024-01-01T00:10:00Z",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      turnCount: 0,
      callCount: 0,
      costComputed: 0,
      cacheHitPct: 0,
    };
    expect(session.cacheSavingsComputed).toBeUndefined();
  });

  it("maxTurnCostComputed defaults to undefined", () => {
    const session: Session = {
      sessionId: "sess-001",
      lineageId: "lin-001",
      project: "test",
      entrypoint: "/test",
      models: ["gpt-4o"],
      gitBranch: "main",
      version: "0.0.0",
      host: "default",
      tier: {
        hasCostSamples: true,
        hasTurnBoundaries: true,
        hasCostLog: false,
        costBasis: "computed",
      },
      firstAt: "2024-01-01T00:00:00Z",
      lastAt: "2024-01-01T00:10:00Z",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      turnCount: 0,
      callCount: 0,
      costComputed: 0,
      cacheHitPct: 0,
    };
    expect(session.maxTurnCostComputed).toBeUndefined();
  });

  it("contextPctEstimated defaults to undefined", () => {
    const session: Session = {
      sessionId: "sess-001",
      lineageId: "lin-001",
      project: "test",
      entrypoint: "/test",
      models: ["gpt-4o"],
      gitBranch: "main",
      version: "0.0.0",
      host: "default",
      tier: {
        hasCostSamples: true,
        hasTurnBoundaries: true,
        hasCostLog: false,
        costBasis: "computed",
      },
      firstAt: "2024-01-01T00:00:00Z",
      lastAt: "2024-01-01T00:10:00Z",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      turnCount: 0,
      callCount: 0,
      costComputed: 0,
      cacheHitPct: 0,
    };
    expect(session.contextPctEstimated).toBeUndefined();
  });

  it("preserves existing fields", () => {
    const session: Session = {
      sessionId: "sess-001",
      lineageId: "lin-001",
      slug: "my-session",
      project: "test",
      entrypoint: "/test",
      models: ["gpt-4o"],
      gitBranch: "main",
      version: "0.0.0",
      host: "default",
      tier: {
        hasCostSamples: true,
        hasTurnBoundaries: true,
        hasCostLog: false,
        costBasis: "computed",
      },
      firstAt: "2024-01-01T00:00:00Z",
      lastAt: "2024-01-01T00:10:00Z",
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheCreateTokens: 100 },
      turnCount: 5,
      callCount: 10,
      costComputed: 0.25,
      costObserved: 0.27,
      durationMs: 60000,
      cacheHitPct: 40,
      linesAdded: 100,
      linesRemoved: 20,
      gateScore: 0.95,
    };
    // Verify all existing required + optional fields are present
    expect(session.sessionId).toBe("sess-001");
    expect(session.lineageId).toBe("lin-001");
    expect(session.slug).toBe("my-session");
    expect(session.project).toBe("test");
    expect(session.models).toEqual(["gpt-4o"]);
    expect(session.gitBranch).toBe("main");
    expect(session.version).toBe("0.0.0");
    expect(session.tier.costBasis).toBe("computed");
    expect(session.firstAt).toBe("2024-01-01T00:00:00Z");
    expect(session.lastAt).toBe("2024-01-01T00:10:00Z");
    expect(session.usage.inputTokens).toBe(1000);
    expect(session.turnCount).toBe(5);
    expect(session.callCount).toBe(10);
    expect(session.costComputed).toBe(0.25);
    expect(session.costObserved).toBe(0.27);
    expect(session.durationMs).toBe(60000);
    expect(session.cacheHitPct).toBe(40);
    expect(session.linesAdded).toBe(100);
    expect(session.linesRemoved).toBe(20);
    expect(session.gateScore).toBe(0.95);
  });
});

describe("Turn — additive optional field", () => {
  it("errorToolResults defaults to undefined", () => {
    const turn: Turn = {
      promptId: "prompt-001",
      sessionId: "sess-001",
      isSidechain: false,
      startedAt: "2024-01-01T10:00:00Z",
      endedAt: "2024-01-01T10:05:00Z",
      calls: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      toolResultBytes: 0,
    };
    expect(turn.errorToolResults).toBeUndefined();
  });

  it("preserves existing fields", () => {
    const turn: Turn = {
      promptId: "prompt-001",
      sessionId: "sess-001",
      isSidechain: false,
      promptText: "Hello",
      promptSource: "user",
      startedAt: "2024-01-01T10:00:00Z",
      endedAt: "2024-01-01T10:05:00Z",
      calls: [],
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheCreateTokens: 10 },
      toolResultBytes: 1024,
      wallMs: 3000,
      gateStatus: "pass",
    };
    expect(turn.promptId).toBe("prompt-001");
    expect(turn.sessionId).toBe("sess-001");
    expect(turn.isSidechain).toBe(false);
    expect(turn.promptText).toBe("Hello");
    expect(turn.promptSource).toBe("user");
    expect(turn.startedAt).toBe("2024-01-01T10:00:00Z");
    expect(turn.endedAt).toBe("2024-01-01T10:05:00Z");
    expect(turn.calls).toEqual([]);
    expect(turn.usage.inputTokens).toBe(100);
    expect(turn.toolResultBytes).toBe(1024);
    expect(turn.wallMs).toBe(3000);
    expect(turn.gateStatus).toBe("pass");
  });
});
