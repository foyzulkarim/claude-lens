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
