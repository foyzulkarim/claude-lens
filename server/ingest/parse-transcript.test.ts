import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ParsedLine, parseTranscriptLine, parseTranscriptLines } from "./parse-transcript.js";

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

function assistantLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "assistant",
    uuid: "uuid-1",
    sessionId: "session-1",
    timestamp: "2026-07-03T04:46:51.065Z",
    cwd: "/Users/demo/.claude",
    gitBranch: "main",
    version: "2.1.199",
    entrypoint: "cli",
    isSidechain: false,
    message: {
      id: "msg_1",
      model: "claude-sonnet-5",
      role: "assistant",
      type: "message",
      stop_reason: "end_turn",
      content: [],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    ...overrides,
  });
}

function userLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "user",
    uuid: "uuid-2",
    sessionId: "session-1",
    promptId: "prompt-1",
    timestamp: "2026-07-03T04:46:46.767Z",
    cwd: "/Users/demo/.claude",
    gitBranch: "main",
    version: "2.1.199",
    entrypoint: "cli",
    isSidechain: false,
    message: {
      role: "user",
      content: "hello world",
    },
    ...overrides,
  });
}

function expectCall(result: ParsedLine) {
  if (result.kind !== "call") throw new Error(`expected call, got ${result.kind}`);
  return result.call;
}

describe("parseTranscriptLine — assistant line mapping", () => {
  it("maps core assistant fields", () => {
    const call = expectCall(parseTranscriptLine(assistantLine(), new Set()));
    expect(call).toMatchObject({
      uuid: "uuid-1",
      sessionId: "session-1",
      messageId: "msg_1",
      model: "claude-sonnet-5",
      cwd: "/Users/demo/.claude",
      gitBranch: "main",
      version: "2.1.199",
      entrypoint: "cli",
      stopReason: "end_turn",
    });
  });

  it("maps token usage including cache TTL buckets", () => {
    const line = assistantLine({
      message: {
        id: "msg_2",
        model: "claude-sonnet-5",
        content: [],
        usage: {
          input_tokens: 12031,
          output_tokens: 184,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 17176,
          cache_creation: {
            ephemeral_5m_input_tokens: 200,
            ephemeral_1h_input_tokens: 16976,
          },
        },
      },
    });

    const call = expectCall(parseTranscriptLine(line, new Set()));
    expect(call.usage).toMatchObject({
      inputTokens: 12031,
      outputTokens: 184,
      cacheReadTokens: 500,
      cacheCreateTokens: 17176,
      cacheCreate5m: 200,
      cacheCreate1h: 16976,
    });
  });

  it("defaults usage fields when cache_creation is absent", () => {
    const line = assistantLine({
      message: {
        id: "msg_3",
        model: "claude-sonnet-5",
        content: [],
        usage: { input_tokens: 5, output_tokens: 1 },
      },
    });

    const call = expectCall(parseTranscriptLine(line, new Set()));
    expect(call.usage.cacheCreate5m).toBeUndefined();
    expect(call.usage.cacheCreate1h).toBeUndefined();
    expect(call.usage.cacheReadTokens).toBe(0);
    expect(call.usage.cacheCreateTokens).toBe(0);
  });

  it("extracts tool_use blocks into tools[]", () => {
    const line = assistantLine({
      message: {
        id: "msg_4",
        model: "claude-sonnet-5",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "/x" } },
        ],
      },
    });

    const call = expectCall(parseTranscriptLine(line, new Set()));
    expect(call.tools).toHaveLength(2);
    expect(call.tools[0]).toMatchObject({
      name: "Bash",
      inputBytes: Buffer.byteLength(JSON.stringify({ command: "ls" }), "utf8"),
    });
    expect(call.tools[1].name).toBe("Read");
  });

  it("marks API-error responses without treating them as malformed", () => {
    const line = assistantLine({
      isApiErrorMessage: true,
      apiErrorStatus: 429,
      message: {
        id: "msg_5",
        model: "claude-sonnet-5",
        content: [],
        usage: {},
      },
    });

    const result = parseTranscriptLine(line, new Set());
    expect(result.kind).toBe("call");
    const call = expectCall(result);
    expect(call.isApiError).toBe(true);
    expect(call.apiErrorStatus).toBe(429);
  });

  it("carries sidechain attribution", () => {
    const line = assistantLine({ isSidechain: true, agentId: "agent-abc" });
    const call = expectCall(parseTranscriptLine(line, new Set()));
    expect(call.isSidechain).toBe(true);
    expect(call.agentId).toBe("agent-abc");
  });
});

describe("parseTranscriptLine — dedupe", () => {
  it("dedupes repeated message.id", () => {
    const seen = new Set<string>();
    const line = assistantLine();

    const first = parseTranscriptLine(line, seen);
    const second = parseTranscriptLine(line, seen);

    expect(first.kind).toBe("call");
    expect(second.kind).toBe("duplicate");

    const batch = parseTranscriptLines([line, line], new Set());
    expect(batch.calls).toHaveLength(1);
    expect(batch.duplicateCount).toBe(1);
  });
});

describe("parseTranscriptLine — user line handling", () => {
  it("captures typed prompt text", () => {
    const result = parseTranscriptLine(userLine(), new Set());
    expect(result.kind).toBe("prompt");
    if (result.kind !== "prompt") throw new Error("expected prompt");
    expect(result.prompt).toEqual({
      sessionId: "session-1",
      promptId: "prompt-1",
      text: "hello world",
      timestamp: "2026-07-03T04:46:46.767Z",
    });
  });

  it("captures tool_result byte sizes without retaining content", () => {
    const content = "a".repeat(50);
    const line = userLine({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content }],
      },
    });

    const result = parseTranscriptLine(line, new Set());
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") return;
    expect(result.record).toEqual({
      sessionId: "session-1",
      promptId: "prompt-1",
      toolUseId: "toolu_1",
      bytes: Buffer.byteLength(content, "utf8"),
      isError: false,
      isSidechain: false, // review #3: main-thread default
    });
  });
});

describe("parseTranscriptLine — tool_result isError classification", () => {
  // Helper: build a tool_result user line with the given content
  function toolResultLine(content: string, extra: Record<string, unknown> = {}): string {
    return userLine({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", content, ...extra }],
      },
      ...extra,
    });
  }

  // Review #11: the Bash-only exit-code fallback requires the parser to
  // know the originating tool's name. In real transcripts this is recorded
  // by the earlier assistant tool_use block; in unit tests we pre-seed the
  // map so each `parseTranscriptLine` call can resolve it directly.
  function bashToolUseMap(): Map<string, string> {
    return new Map([["toolu_1", "Bash"]]);
  }

  it("classifies raw is_error: true as isError: true (any tool)", () => {
    const result = parseTranscriptLine(
      toolResultLine("something went wrong", { is_error: true }),
      new Set(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("classifies raw is_error: true as isError: true even when originating tool is not Bash", () => {
    // Read tool_result with is_error=true stays authoritative regardless
    // of which tool produced it (review #11 — we never silence is_error
    // for non-Bash tools).
    const readMap = new Map([["toolu_1", "Read"]]);
    const result = parseTranscriptLine(
      toolResultLine("ENOENT: no such file", { is_error: true }),
      new Set(),
      readMap,
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("classifies non-zero Bash exit code 1 as isError: true", () => {
    const result = parseTranscriptLine(
      toolResultLine("Command failed with exit code 1\nsome error output"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("classifies Bash exit code 42 as isError: true", () => {
    const result = parseTranscriptLine(
      toolResultLine("error: exit code 42"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("classifies 'returned exit code 1' as isError: true (Bash)", () => {
    const result = parseTranscriptLine(
      toolResultLine("process exited. returned exit code 1"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("classifies 'exit_code: 5' JSON-style exit code as isError: true (Bash)", () => {
    const result = parseTranscriptLine(
      toolResultLine('{"exit_code": 5, "message": "failed"}'),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("does NOT flag Bash exit code 0 as error", () => {
    const result = parseTranscriptLine(
      toolResultLine("Command succeeded. exit code 0"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(false);
  });

  it("review #11 regression: 'exit code 0; copied 1 file' is NOT an error (anchored regex)", () => {
    // The pre-fix greedy regex matched the trailing "1" in "copied 1 file"
    // because the dot-star swallowed any characters before [1-9]. The
    // fix anchors the parsed number to be the immediately-following token.
    const result = parseTranscriptLine(
      toolResultLine("Some log line\nCommand succeeded. exit code 0; copied 1 file\nDone"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(false);
  });

  it("review #11 regression: exit code 1 preceded by other '1' digits is still detected", () => {
    // Anchored regex still picks up the immediately-adjacent exit code
    // even when other "1" digits appear later in the body.
    const result = parseTranscriptLine(
      toolResultLine("Iteration 1 of 5\nexit code 1\nran 1 test"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(true);
  });

  it("review #11: non-Bash tool mentioning 'exit code 1' is NOT flagged (review #11 / CQ4)", () => {
    // The pre-fix regex ran unconditionally on every tool_result body and
    // would falsely flag non-Bash tools (e.g. a Read tool_result quoting
    // documentation). Now only Bash gets the fallback; non-Bash tools rely
    // solely on the raw is_error flag.
    const readMap = new Map([["toolu_1", "Read"]]);
    const result = parseTranscriptLine(
      toolResultLine("doc says: run with exit code 1 to enable verbose mode"),
      new Set(),
      readMap,
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(false);
  });

  it("returns isError: false for a normal tool result with no error indicators (Bash)", () => {
    const result = parseTranscriptLine(
      toolResultLine("Here are the files: package.json, README.md"),
      new Set(),
      bashToolUseMap(),
    );
    expect(result.kind).toBe("tool-result-bytes");
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record.isError).toBe(false);
  });

  it("malformed lines never throw even when they look like tool_result blocks", () => {
    expect(() => parseTranscriptLine("not even json {", new Set())).not.toThrow();
    expect(parseTranscriptLine("not even json {", new Set()).kind).toBe("malformed");
  });
});

describe("parseTranscriptLine — skip / malformed classification", () => {
  it.each([
    "mode",
    "ai-title",
    "system/turn_duration",
  ])("skips non-assistant/user line type %s without counting it as malformed", (type) => {
    const line = JSON.stringify({ type, sessionId: "session-1" });
    const result = parseTranscriptLine(line, new Set());
    expect(result.kind).toBe("skipped");

    const batch = parseTranscriptLines([line], new Set());
    expect(batch.malformedCount).toBe(0);
  });

  it("skips blank lines", () => {
    expect(parseTranscriptLine("", new Set()).kind).toBe("skipped");
    expect(parseTranscriptLine("   ", new Set()).kind).toBe("skipped");
  });

  it("counts invalid JSON as malformed, never throws", () => {
    expect(() => parseTranscriptLine("{not valid json", new Set())).not.toThrow();
    expect(parseTranscriptLine("{not valid json", new Set()).kind).toBe("malformed");
  });

  it("counts a structurally broken assistant line as malformed", () => {
    const line = JSON.stringify({ type: "assistant", sessionId: "session-1", message: {} });
    expect(parseTranscriptLine(line, new Set()).kind).toBe("malformed");
  });

  it("treats a partial trailing line as malformed, not a crash", () => {
    const partial = assistantLine().slice(0, -10);
    expect(() => parseTranscriptLine(partial, new Set())).not.toThrow();
    expect(parseTranscriptLine(partial, new Set()).kind).toBe("malformed");
  });
});

describe("parseTranscriptLines — batch aggregation resilience", () => {
  it("continues past a malformed line mid-batch", () => {
    const lines = [
      assistantLine({ message: { id: "msg_a", model: "m", content: [], usage: {} } }),
      "{broken",
      assistantLine({ message: { id: "msg_b", model: "m", content: [], usage: {} } }),
    ];

    const result = parseTranscriptLines(lines, new Set());
    expect(result.malformedCount).toBe(1);
    expect(result.calls).toHaveLength(2);
    expect(result.calls.map((c) => c.messageId)).toEqual(["msg_a", "msg_b"]);
  });

  it("propagates toolUseId → toolName across an assistant→user batch boundary (review #11)", () => {
    // The Bash-only exit-code fallback requires that an assistant `tool_use`
    // block (line 1) declare the tool name, then a user `tool_result` block
    // (line 2) reference that id and trigger the fallback classification.
    // This test proves the parser threads the map across lines within a
    // single batch — without that propagation the second line below would
    // default to isError: false on a genuine Bash failure.
    const assistantBashCall = assistantLine({
      message: {
        id: "msg_a",
        model: "claude-sonnet-5",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "tool_use", id: "toolu_bash_1", name: "Bash", input: { command: "ls" } }],
      },
    });
    const bashResult = userLine({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_bash_1", content: "exit code 1" }],
      },
    });

    const result = parseTranscriptLines([assistantBashCall, bashResult], new Set());
    expect(result.toolResultBytes).toHaveLength(1);
    expect(result.toolResultBytes[0]?.isError).toBe(true);
  });

  it("warm-cache reconstruction accepts a pre-populated toolUseId map (review #11)", () => {
    // Warm-cache loads parse results for files previously parsed in earlier
    // batches. When batches span multiple `parseTranscriptLines` calls, the
    // caller can pass a pre-populated toolNameByToolUseId map so tool_result
    // records referring to tools declared in earlier batches still resolve.
    const toolNameByToolUseId = new Map([["toolu_warm", "Bash"]]);
    const bashResult = userLine({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_warm", content: "exit code 1" }],
      },
    });
    const result = parseTranscriptLines([bashResult], new Set(), toolNameByToolUseId);
    expect(result.toolResultBytes[0]?.isError).toBe(true);
  });
});

describe("fixture tree — pins the compact-record contract", () => {
  it("clean multi-turn fixture parses to expected counts", () => {
    const lines = readFixtureLines("11111111-1111-4111-8111-111111111111.jsonl");
    const result = parseTranscriptLines(lines, new Set());

    expect(result.calls).toHaveLength(5);
    expect(result.duplicateCount).toBe(1);
    expect(result.prompts).toHaveLength(2);
    expect(result.toolResultBytes).toHaveLength(1);
    expect(result.malformedCount).toBe(0);

    expect(result.calls.some((c) => c.isSidechain)).toBe(true);
    expect(new Set(result.calls.map((c) => c.model)).size).toBeGreaterThanOrEqual(2);
    expect(result.calls.some((c) => (c.usage.cacheCreate5m ?? 0) > 0)).toBe(true);
    expect(result.calls.some((c) => (c.usage.cacheCreate1h ?? 0) > 0)).toBe(true);
  });

  it("malformed-lines fixture produces the exact expected malformed count", () => {
    const lines = readFixtureLines("22222222-2222-4222-8222-222222222222.jsonl");
    const result = parseTranscriptLines(lines, new Set());

    expect(result.malformedCount).toBe(5);
    expect(result.calls).toHaveLength(4);
  });

  it("partial-trailing-line fixture's last line is malformed, earlier lines are not", () => {
    const lines = readFixtureLines("33333333-3333-4333-8333-333333333333.jsonl");
    const seen = new Set<string>();
    const results = lines.map((line) => parseTranscriptLine(line, seen));

    expect(results.slice(0, -1).every((r) => r.kind === "call")).toBe(true);
    expect(results[results.length - 1].kind).toBe("malformed");
  });
});
