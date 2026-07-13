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
    if (result.kind !== "tool-result-bytes") throw new Error("expected tool-result-bytes");
    expect(result.record).toEqual({
      sessionId: "session-1",
      promptId: "prompt-1",
      toolUseId: "toolu_1",
      bytes: Buffer.byteLength(content, "utf8"),
    });
    expect(JSON.stringify(result.record)).not.toContain(content);
  });

  it("ignores array-shaped text blocks for prompt capture", () => {
    const line = userLine({
      message: {
        role: "user",
        content: [{ type: "text", text: "injected meta text" }],
      },
    });

    const result = parseTranscriptLine(line, new Set());
    expect(result.kind).toBe("skipped");
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
