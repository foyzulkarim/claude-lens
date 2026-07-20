import { describe, expect, it } from "vitest";
import type { PromptSearchDoc } from "../../shared/search-index-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";
import type { PromptTextRecord } from "../ingest/parse-transcript.js";
import { buildSearchSnapshot } from "./build-search-snapshot.js";

function baseCall(): ApiCall {
  return {
    uuid: "u",
    sessionId: "s1",
    messageId: "m",
    timestamp: "2026-06-10T10:00:00.000Z",
    model: "claude-sonnet-5",
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
  };
}

function mkTurn(promptId: string): Turn {
  return {
    promptId,
    sessionId: "s1",
    isSidechain: false,
    startedAt: "2026-06-10T10:00:00.000Z",
    endedAt: "2026-06-10T10:00:01.000Z",
    calls: [baseCall()],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 },
    toolResultBytes: 0,
  };
}

function mkPrompt(
  promptId: string,
  text: string,
  timestamp: string,
  sessionId = "s1",
): PromptTextRecord {
  return { promptId, sessionId, text, timestamp };
}

describe("buildSearchSnapshot — empty / minimal inputs", () => {
  it("returns an empty array and version 1 when no sessions are provided", () => {
    const out = buildSearchSnapshot({ sessions: [] });
    expect(out).toEqual({ prompts: [], version: 1 });
  });

  it("returns an empty array when a session has no prompts", () => {
    const out = buildSearchSnapshot({
      sessions: [{ sessionId: "s1", prompts: [], turns: [] }],
    });
    expect(out).toEqual({ prompts: [], version: 1 });
  });
});

describe("buildSearchSnapshot — single session", () => {
  it("emits one doc per prompt with resolved turnNumber", () => {
    const out = buildSearchSnapshot({
      sessions: [
        {
          sessionId: "s1",
          cwd: "/repo/alpha",
          gitBranch: "main",
          prompts: [
            mkPrompt("p1", "first", "2026-06-10T10:00:00.000Z"),
            mkPrompt("p2", "second", "2026-06-10T10:01:00.000Z"),
          ],
          turns: [mkTurn("p1"), mkTurn("p2")],
        },
      ],
    });
    expect(out.prompts).toEqual<PromptSearchDoc[]>([
      {
        id: "s1:p1",
        sessionId: "s1",
        promptId: "p1",
        turnNumber: 1,
        text: "first",
        timestamp: "2026-06-10T10:00:00.000Z",
        cwd: "/repo/alpha",
        gitBranch: "main",
      },
      {
        id: "s1:p2",
        sessionId: "s1",
        promptId: "p2",
        turnNumber: 2,
        text: "second",
        timestamp: "2026-06-10T10:01:00.000Z",
        cwd: "/repo/alpha",
        gitBranch: "main",
      },
    ]);
    expect(out.version).toBe(1);
  });

  it("uses fallback turnNumber (turns.length + 1) for an unresolved prompt", () => {
    const out = buildSearchSnapshot({
      sessions: [
        {
          sessionId: "s1",
          prompts: [mkPrompt("p-orphan", "lonely user line", "2026-06-10T10:00:00.000Z")],
          turns: [mkTurn("p1")],
        },
      ],
    });
    expect(out.prompts[0]?.turnNumber).toBe(2); // 1 turn + 1 fallback
    expect(out.prompts[0]?.promptId).toBe("p-orphan");
  });

  it("omits cwd/gitBranch fields when not provided on the session", () => {
    const out = buildSearchSnapshot({
      sessions: [
        {
          sessionId: "s1",
          prompts: [mkPrompt("p1", "no-context prompt", "2026-06-10T10:00:00.000Z")],
          turns: [mkTurn("p1")],
        },
      ],
    });
    const doc = out.prompts[0];
    expect(doc).toBeDefined();
    expect(doc).not.toHaveProperty("cwd");
    expect(doc).not.toHaveProperty("gitBranch");
  });
});

describe("buildSearchSnapshot — multi-session", () => {
  it("sorts by (timestamp, sessionId, promptId) deterministically", () => {
    const out = buildSearchSnapshot({
      sessions: [
        {
          sessionId: "s1",
          prompts: [
            mkPrompt("p2", "second", "2026-06-10T10:01:00.000Z", "s1"),
            mkPrompt("p1", "first", "2026-06-10T10:00:00.000Z", "s1"),
          ],
          turns: [mkTurn("p1"), mkTurn("p2")],
        },
        {
          sessionId: "s2",
          prompts: [mkPrompt("p1", "s2-first", "2026-06-10T10:00:00.000Z", "s2")],
          turns: [mkTurn("p1")],
        },
      ],
    });
    expect(out.prompts.map((d) => d.id)).toEqual(["s1:p1", "s2:p1", "s1:p2"]);
  });

  it("resolves turnNumber per session, not globally", () => {
    const out = buildSearchSnapshot({
      sessions: [
        {
          sessionId: "s1",
          prompts: [mkPrompt("p-late", "late in s1", "2026-06-10T10:00:00.000Z", "s1")],
          turns: [mkTurn("p1"), mkTurn("p2"), mkTurn("p3")],
        },
        {
          sessionId: "s2",
          prompts: [mkPrompt("p-late", "late in s2", "2026-06-10T10:00:00.000Z", "s2")],
          turns: [mkTurn("p-x")],
        },
      ],
    });
    const s1Doc = out.prompts.find((d) => d.sessionId === "s1");
    const s2Doc = out.prompts.find((d) => d.sessionId === "s2");
    // s1 has 3 turns + fallback = 4 for an unresolved prompt
    expect(s1Doc?.turnNumber).toBe(4);
    // s2 has 1 turn + fallback = 2
    expect(s2Doc?.turnNumber).toBe(2);
  });
});

describe("buildSearchSnapshot — duplicate promptId within a session", () => {
  it("disambiguates repeated promptId with an ordinal suffix so every id is unique", () => {
    const out = buildSearchSnapshot({
      sessions: [
        {
          sessionId: "s1",
          prompts: [
            mkPrompt("p1", "first attempt", "2026-06-10T10:00:00.000Z"),
            mkPrompt("p1", "retried attempt", "2026-06-10T10:00:05.000Z"),
            mkPrompt("p1", "third attempt", "2026-06-10T10:00:10.000Z"),
          ],
          turns: [mkTurn("p1")],
        },
      ],
    });
    const ids = out.prompts.map((d) => d.id);
    expect(ids).toEqual(["s1:p1", "s1:p1:1", "s1:p1:2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildSearchSnapshot — version", () => {
  it("accepts an explicit version override", () => {
    const out = buildSearchSnapshot({ sessions: [] }, { version: 42 });
    expect(out.version).toBe(42);
  });
});
