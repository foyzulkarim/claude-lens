import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTranscriptPeek } from "./transcript-peek.js";

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "transcript-peek-"));
  filePath = join(dir, "transcript.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function line(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

describe("buildTranscriptPeek — happy path", () => {
  it("extracts assistant text, tool_use inputs, and tool_result bodies inside the window", async () => {
    await writeFile(
      filePath,
      [
        // Before window — must be skipped.
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:00:00.000Z",
          message: { content: [{ type: "text", text: "before window" }] },
        }),
        // Inside window — assistant text.
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:00:30.000Z",
          message: { content: [{ type: "text", text: "Reading the file now." }] },
        }),
        // Inside window — tool_use.
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:00:31.000Z",
          message: {
            content: [
              { type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/repo/x.ts" } },
            ],
          },
        }),
        // Inside window — tool_result with matching toolUseId.
        line({
          type: "user",
          timestamp: "2026-07-14T10:00:32.000Z",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu1",
                content: "export const x = 1;",
              },
            ],
          },
        }),
        // After window — must be skipped.
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:01:00.000Z",
          message: { content: [{ type: "text", text: "after window" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:30.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    expect(result).not.toBeNull();
    expect(result?.lines.map((l) => l.role)).toEqual(["assistant-text", "tool-use", "tool-result"]);
    expect(result?.lines[0]).toMatchObject({ preview: "Reading the file now." });
    expect(result?.lines[1]).toMatchObject({
      toolName: "Read",
      preview: JSON.stringify({ file_path: "/repo/x.ts" }),
    });
    expect(result?.lines[2]).toMatchObject({
      toolName: "Read",
      preview: "export const x = 1;",
      bytes: Buffer.byteLength("export const x = 1;", "utf8"),
    });
    expect(result?.truncated).toBe(false);
  });
});

describe("buildTranscriptPeek — empty / malformed inputs", () => {
  it("returns null when the file doesn't exist (moved/deleted since ingest)", async () => {
    const result = await buildTranscriptPeek(
      join(dir, "does-not-exist.jsonl"),
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:30.000Z",
    );
    expect(result).toBeNull();
  });

  it("returns empty lines for a syntactically-valid file with no in-window content", async () => {
    await writeFile(
      filePath,
      [
        line({
          type: "assistant",
          timestamp: "2026-07-14T09:00:00.000Z",
          message: { content: [{ type: "text", text: "way before" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:30.000Z",
    );

    expect(result).toEqual({ lines: [], truncated: false });
  });

  it("silently skips malformed JSON lines and missing timestamps", async () => {
    await writeFile(
      filePath,
      [
        "not json",
        line({ type: "assistant", message: { content: [{ type: "text", text: "no ts" }] } }),
        line({
          type: "assistant",
          timestamp: "not-a-date",
          message: { content: [{ type: "text", text: "bad ts" }] },
        }),
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:00:30.000Z",
          message: { content: [{ type: "text", text: "kept" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0]?.preview).toBe("kept");
  });

  it("treats a window with unparseable bounds as the whole file (open-ended)", async () => {
    // Defensive fallback: if either bound fails to parse, the contract is
    // "show everything" rather than "show nothing" — a page never gets
    // stuck on a NaN window.
    await writeFile(
      filePath,
      line({
        type: "assistant",
        timestamp: "2026-07-14T10:00:30.000Z",
        message: { content: [{ type: "text", text: "kept" }] },
      }),
      "utf8",
    );

    const result = await buildTranscriptPeek(filePath, "not-a-date", "still-not-a-date");

    expect(result?.lines).toHaveLength(1);
  });
});

describe("buildTranscriptPeek — truncation", () => {
  it("truncates any preview longer than 200 chars and sets truncated=true", async () => {
    const longText = "x".repeat(420);
    await writeFile(
      filePath,
      line({
        type: "assistant",
        timestamp: "2026-07-14T10:00:30.000Z",
        message: { content: [{ type: "text", text: longText }] },
      }),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    expect(result?.lines[0]?.preview.length).toBe(201); // 200 chars + ellipsis
    expect(result?.lines[0]?.preview.endsWith("…")).toBe(true);
    expect(result?.truncated).toBe(true);
  });

  it("preserves short previews without an ellipsis", async () => {
    await writeFile(
      filePath,
      line({
        type: "assistant",
        timestamp: "2026-07-14T10:00:30.000Z",
        message: { content: [{ type: "text", text: "short" }] },
      }),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    expect(result?.lines[0]?.preview).toBe("short");
    expect(result?.truncated).toBe(false);
  });
});

describe("buildTranscriptPeek — tool_result labeling", () => {
  it("labels tool_result with the originating tool name when toolUseId is recognized", async () => {
    await writeFile(
      filePath,
      [
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:00:30.000Z",
          message: {
            content: [{ type: "tool_use", id: "tu_known", name: "Bash", input: { command: "ls" } }],
          },
        }),
        line({
          type: "user",
          timestamp: "2026-07-14T10:00:31.000Z",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu_known", content: "file.txt" }],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    const toolResult = result?.lines.find((l) => l.role === "tool-result");
    expect(toolResult?.toolName).toBe("Bash");
  });

  it("omits toolName on tool_result when the toolUseId is unknown", async () => {
    // Warm-cache reconstruction gaps / orphaned tool_results: the parser
    // can't recover the originating tool, so the wire field is omitted.
    await writeFile(
      filePath,
      line({
        type: "user",
        timestamp: "2026-07-14T10:00:30.000Z",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_orphan", content: "body" }],
        },
      }),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    const toolResult = result?.lines.find((l) => l.role === "tool-result");
    expect(toolResult?.toolName).toBeUndefined();
    expect(toolResult?.bytes).toBe(4);
  });
});

describe("buildTranscriptPeek — non-text blocks are skipped", () => {
  it("ignores assistant blocks that aren't text or tool_use", async () => {
    await writeFile(
      filePath,
      [
        line({
          type: "assistant",
          timestamp: "2026-07-14T10:00:30.000Z",
          message: {
            content: [
              { type: "thinking", thinking: "internal" },
              { type: "text", text: "visible" },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await buildTranscriptPeek(
      filePath,
      "2026-07-14T10:00:00.000Z",
      "2026-07-14T10:00:45.000Z",
    );

    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0]?.preview).toBe("visible");
  });
});
