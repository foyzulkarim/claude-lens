import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTranscriptLines } from "../ingest/parse-transcript.js";
import { deriveTurns } from "./derive-turns.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(
  __dirname,
  "..",
  "..",
  "test",
  "fixtures",
  "projects",
  "-Users-demo-project-alpha",
);

function readFixtureLines(filename: string): string[] {
  const content = readFileSync(join(fixturesDir, filename), "utf8");
  return content.split("\n").filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === ""));
}

describe("deriveTurns — fixture-driven", () => {
  it("groups the clean multi-turn fixture into two prompt turns plus one sidechain turn", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());

    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    // prompt-1 (msg_1, msg_2), prompt-2 main (msg_3, msg_5), prompt-2 sidechain (msg_4).
    expect(turns).toHaveLength(3);

    const turn1 = turns.find((t) => t.promptId === "prompt-1" && !t.isSidechain);
    expect(turn1?.calls.map((c) => c.messageId)).toEqual(["msg_1", "msg_2"]);
    expect(turn1?.promptText).toBe("List the files in this repo");

    const turn2Main = turns.find((t) => t.promptId === "prompt-2" && !t.isSidechain);
    expect(turn2Main?.calls.map((c) => c.messageId)).toEqual(["msg_3", "msg_5"]);

    const turn2Side = turns.find((t) => t.promptId === "prompt-2" && t.isSidechain);
    expect(turn2Side?.calls.map((c) => c.messageId)).toEqual(["msg_4"]);
    expect(turn2Side?.promptText).toBeUndefined();
  });

  it("sums usage across a turn's calls, including both cache TTL buckets", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const turn1 = turns.find((t) => t.promptId === "prompt-1" && !t.isSidechain);
    // msg_1: in=1000 out=50 cacheCreate=300 (5m=300); msg_2: in=1200 out=40 cacheRead=1000 cacheCreate=5000 (1h=5000)
    expect(turn1?.usage).toMatchObject({
      inputTokens: 2200,
      outputTokens: 90,
      cacheReadTokens: 1000,
      cacheCreateTokens: 5300,
      cacheCreate5m: 300,
      cacheCreate1h: 5000,
    });
  });

  it("attributes tool_result bytes to the main turn sharing the prompt", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const parsed = parseTranscriptLines(lines, new Set());
    const turns = deriveTurns(parsed.calls, parsed.prompts, parsed.toolResultBytes);

    const turn1 = turns.find((t) => t.promptId === "prompt-1" && !t.isSidechain);
    expect(turn1?.toolResultBytes).toBeGreaterThan(0);
  });

  it("excludes calls that precede every known prompt in the session", () => {
    const calls = [
      {
        uuid: "u1",
        sessionId: "s1",
        messageId: "m1",
        timestamp: "2020-01-01T00:00:00.000Z",
        model: "claude-sonnet-5",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 },
        isSidechain: false,
        tools: [],
        cwd: "/x",
        gitBranch: "main",
        version: "1.0.0",
        entrypoint: "cli",
      },
    ];

    const turns = deriveTurns(calls, [], []);
    expect(turns).toHaveLength(0);
  });

  it("returns an empty array for a session with no calls", () => {
    expect(deriveTurns([], [], [])).toEqual([]);
  });

  it("assigns calls to the correct prompt by timestamp even when both arrays are given out of order", () => {
    function call(messageId: string, timestamp: string) {
      return {
        uuid: `u-${messageId}`,
        sessionId: "s1",
        messageId,
        timestamp,
        model: "claude-sonnet-5",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreateTokens: 0 },
        isSidechain: false,
        tools: [],
        cwd: "/x",
        gitBranch: "main",
        version: "1.0.0",
        entrypoint: "cli",
      };
    }

    // Chronologically: prompt-1 (00:00:00) -> m1 (00:00:01) -> prompt-2 (00:02:00) -> m2 (00:02:01).
    // Both arrays are passed in reverse-chronological order to prove
    // assignPromptIds sorts by timestamp rather than trusting array order.
    const calls = [call("m2", "2026-07-14T00:02:01.000Z"), call("m1", "2026-07-14T00:00:01.000Z")];
    const prompts = [
      {
        sessionId: "s1",
        promptId: "prompt-2",
        text: "second",
        timestamp: "2026-07-14T00:02:00.000Z",
      },
      {
        sessionId: "s1",
        promptId: "prompt-1",
        text: "first",
        timestamp: "2026-07-14T00:00:00.000Z",
      },
    ];

    const turns = deriveTurns(calls, prompts, []);

    const turn1 = turns.find((t) => t.promptId === "prompt-1");
    const turn2 = turns.find((t) => t.promptId === "prompt-2");
    expect(turn1?.calls.map((c) => c.messageId)).toEqual(["m1"]);
    expect(turn2?.calls.map((c) => c.messageId)).toEqual(["m2"]);
  });
});
describe("deriveTurns — errorToolResults aggregation", () => {
  function makeCall(messageId: string, sessionId = "s1"): import("../../shared/types.js").ApiCall {
    return {
      uuid: `u-${messageId}`,
      sessionId,
      messageId,
      timestamp: "2026-07-13T00:00:00.000Z",
      model: "claude-sonnet-5",
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreateTokens: 0 },
      isSidechain: false,
      tools: [],
      cwd: "/repo",
      gitBranch: "main",
      version: "1.0.0",
      entrypoint: "cli",
    };
  }

  function makePrompt(promptId: string, sessionId = "s1") {
    return {
      sessionId,
      promptId,
      text: `prompt ${promptId}`,
      timestamp: "2026-07-13T00:00:00.000Z",
    };
  }

  function makeToolResult(promptId: string, toolUseId: string, isError: boolean) {
    return {
      sessionId: "s1",
      promptId,
      toolUseId,
      bytes: 100,
      isError,
    };
  }

  it("aggregates failed tool results per Turn", () => {
    const calls = [makeCall("m1")];
    const prompts = [makePrompt("p1")];
    const toolResults = [
      makeToolResult("p1", "t1", false),
      makeToolResult("p1", "t2", true),
      makeToolResult("p1", "t3", true),
    ];

    const turns = deriveTurns(calls, prompts, toolResults);
    expect(turns).toHaveLength(1);
    expect(turns[0].errorToolResults).toBe(2);
  });

  it("returns 0 errorToolResults when no tool results are errored", () => {
    const calls = [makeCall("m1")];
    const prompts = [makePrompt("p1")];
    const toolResults = [makeToolResult("p1", "t1", false), makeToolResult("p1", "t2", false)];

    const turns = deriveTurns(calls, prompts, toolResults);
    expect(turns[0].errorToolResults).toBe(0);
  });

  it("returns 0 errorToolResults for a turn with no tool results at all", () => {
    const calls = [makeCall("m1")];
    const prompts = [makePrompt("p1")];

    const turns = deriveTurns(calls, prompts, []);
    expect(turns[0].errorToolResults).toBe(0);
  });

  it("missing isError field defaults to false", () => {
    const calls = [makeCall("m1")];
    const prompts = [makePrompt("p1")];
    const toolResults = [
      {
        sessionId: "s1",
        promptId: "p1",
        toolUseId: "t1",
        bytes: 50,
      } as import("../ingest/parse-transcript.js").ToolResultBytesRecord,
    ];

    const turns = deriveTurns(calls, prompts, toolResults);
    expect(turns[0].errorToolResults).toBe(0);
  });

  it("does not count errored tool results from other prompts", () => {
    const calls = [makeCall("m1")];
    const prompts = [makePrompt("p1")];
    const toolResults = [makeToolResult("p2", "t1", true), makeToolResult("p1", "t2", false)];

    const turns = deriveTurns(calls, prompts, toolResults);
    expect(turns[0].errorToolResults).toBe(0);
  });

  it("does not leak sidechain tool_result bytes/errors into the main thread turn (review #3)", () => {
    // Regression for review finding #3: a sub-agent's tool_result records
    // share the parent's `promptId` (Agent-tool convention), so bucketing by
    // promptId alone would silently fold sub-agent bytes/errors into the
    // main turn's toolResultBytes/errorToolResults. The fix keys by
    // `${promptId}::${main|side}` so each side gets its own bucket.
    const calls = [
      { ...makeCall("m1"), isSidechain: false, timestamp: "2026-07-13T00:00:01.000Z" },
      { ...makeCall("m2"), isSidechain: true, timestamp: "2026-07-13T00:00:02.000Z" },
    ];
    const prompts = [makePrompt("p1")];
    const toolResults = [
      { ...makeToolResult("p1", "t-main", true), isSidechain: false, bytes: 100 }, // main: 1 error, 100 bytes
      { ...makeToolResult("p1", "t-side", true), isSidechain: true, bytes: 999 }, // sidechain: 1 error, 999 bytes
    ];

    const turns = deriveTurns(calls, prompts, toolResults);
    expect(turns).toHaveLength(2);
    const mainTurn = turns.find((t) => !t.isSidechain);
    const sideTurn = turns.find((t) => t.isSidechain);
    // Pre-fix: both bytes/errors were attributed to the main turn via
    // `acc.isSidechain ? 0 : map.get(promptId)`. Post-fix: each turn reads
    // its own bucket.
    expect(mainTurn?.toolResultBytes).toBe(100);
    expect(mainTurn?.errorToolResults).toBe(1);
    expect(sideTurn?.toolResultBytes).toBe(999);
    expect(sideTurn?.errorToolResults).toBe(1);
  });

  it("treats a tool_result record without isSidechain as a main-thread record (default)", () => {
    // Backwards-compat guard for any existing fixture or pre-fix data that
    // produced records without the new field — bucketing must default to
    // "main" so existing test fixtures (and live data ingested before the
    // field was populated) don't suddenly read as 0 bytes.
    const calls = [makeCall("m1")];
    const prompts = [makePrompt("p1")];
    const toolResults = [{ ...makeToolResult("p1", "t1", false) }];
    // Deliberately omit isSidechain to mimic a pre-fix record shape.
    delete (toolResults[0] as { isSidechain?: boolean }).isSidechain;

    const turns = deriveTurns(calls, prompts, toolResults);
    expect(turns[0].toolResultBytes).toBe(100);
    expect(turns[0].errorToolResults).toBe(0);
  });
});
