import { readFileSync } from "node:fs";
import { mkdtemp, rm, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ParseTranscriptResult } from "./parse-transcript.js";
import type { RegisteredFile } from "./poller.js";
import type { TailerEvents } from "./tailer.js";
import { Tailer } from "./tailer.js";

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
const partialLineFixture = readFileSync(
  join(fixturesDir, "33333333-3333-4333-8333-333333333333.jsonl"),
);

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-tailer-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function collectEvents() {
  const records: Array<{ file: RegisteredFile; result: ParseTranscriptResult }> = [];
  const resets: RegisteredFile[] = [];
  const removed: RegisteredFile[] = [];
  const events: TailerEvents = {
    onRecords: (file, result) => records.push({ file, result }),
    onFileReset: (file) => resets.push(file),
    onFileRemoved: (file) => removed.push(file),
  };
  return { records, resets, removed, events };
}

function registeredFile(
  path: string,
  size: number,
  overrides: Partial<RegisteredFile> = {},
): RegisteredFile {
  return {
    path,
    class: "transcript",
    sessionId: "11111111-1111-4111-8111-111111111111",
    root: dirname(path),
    size,
    mtime: 0,
    ...overrides,
  };
}

function assistantLine(messageId: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `uuid-${messageId}`,
    sessionId: "session-1",
    timestamp: "2026-07-03T04:46:51.065Z",
    cwd: "/Users/demo/.claude",
    gitBranch: "main",
    version: "2.1.199",
    entrypoint: "cli",
    isSidechain: false,
    message: {
      id: messageId,
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
  });
}

describe("Tailer — growth reads", () => {
  it("reads only appended bytes on growth", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    await writeFile(filePath, `${assistantLine("msg_1")}\n`);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(`${assistantLine("msg_1")}\n`));
    await tailer.onFileAdded(file);

    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);

    const appended = `${assistantLine("msg_2")}\n`;
    await writeFile(filePath, `${assistantLine("msg_1")}\n${appended}`);
    file.size = Buffer.byteLength(`${assistantLine("msg_1")}\n${appended}`);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_2"]);
  });

  it("advances offset past fully-consumed lines (no reparse on next growth)", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    const line2 = `${assistantLine("msg_2")}\n`;
    await writeFile(filePath, line1 + line2);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1 + line2));
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1", "msg_2"]);

    const line3 = `${assistantLine("msg_3")}\n`;
    await writeFile(filePath, line1 + line2 + line3);
    file.size = Buffer.byteLength(line1 + line2 + line3);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_3"]);
  });

  it("withholds a partial trailing line, mid-write", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "33333333-3333-4333-8333-333333333333.jsonl");
    const lines = partialLineFixture.toString("utf8").split("\n");
    const twoCompleteLines = `${lines[0]}\n${lines[1]}\n`;
    await writeFile(filePath, twoCompleteLines);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(twoCompleteLines));
    await tailer.onFileAdded(file);

    expect(records).toHaveLength(1);
    expect(records[0].result.calls).toHaveLength(2);

    // complete the third (previously partial) line on disk
    const fullContent = `${lines[0]}\n${lines[1]}\n${lines[2]}\n`;
    await writeFile(filePath, fullContent);
    file.size = Buffer.byteLength(fullContent);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.malformedCount + records[1].result.calls.length).toBeGreaterThan(0);
  });

  it("emits no records when the delta has no newline at all", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    await writeFile(filePath, `${assistantLine("msg_1")}\n`);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(`${assistantLine("msg_1")}\n`));
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);

    const unterminated = '{"type": "assistant", "unfinished": tr';
    await writeFile(filePath, `${assistantLine("msg_1")}\n${unterminated}`);
    file.size = Buffer.byteLength(`${assistantLine("msg_1")}\n${unterminated}`);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(1);
  });
});

describe("Tailer — truncation fallback", () => {
  it("treats shrink as truncation: reset fires before a from-0 reparse", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    const line2 = `${assistantLine("msg_2")}\n`;
    await writeFile(filePath, line1 + line2);

    const { records, resets, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1 + line2));
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);

    const rewritten = `${assistantLine("msg_9")}\n`;
    await truncate(filePath, 0);
    await writeFile(filePath, rewritten);
    file.size = Buffer.byteLength(rewritten);
    await tailer.onFileChanged(file);

    expect(resets).toHaveLength(1);
    expect(records).toHaveLength(2);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_9"]);
  });

  it("clears the dedupe seen-set on truncation", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1));
    await tailer.onFileAdded(file);
    expect(records[0].result.duplicateCount).toBe(0);

    // shrink then rewrite with the same messageId that was already "seen"
    await truncate(filePath, 0);
    file.size = 0;
    await tailer.onFileChanged(file);

    await writeFile(filePath, line1);
    file.size = Buffer.byteLength(line1);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.duplicateCount).toBe(0);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);
  });
});

describe("Tailer — file lifecycle", () => {
  it("onFileAdded starts a new file at offset 0, no reset emitted", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);

    const { records, resets, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1));
    await tailer.onFileAdded(file);

    expect(resets).toHaveLength(0);
    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);
  });

  it("ignores non-transcript classes", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.cost.jsonl");
    await writeFile(filePath, `${assistantLine("msg_1")}\n`);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(`${assistantLine("msg_1")}\n`), {
      class: "cost",
    });
    await tailer.onFileAdded(file);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(0);
  });

  it("drops state and forwards onFileRemoved; re-added file starts fresh at offset 0", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);

    const { records, removed, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1));
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);

    tailer.onFileRemoved(file);
    expect(removed).toHaveLength(1);
    expect(removed[0].path).toBe(filePath);

    // re-add: brand-new file, offset back to 0, full reparse
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(2);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);
  });
});

describe("Tailer — concurrency & errors", () => {
  it("serializes overlapping onFileChanged calls on the same file", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1));
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);

    const line2 = `${assistantLine("msg_2")}\n`;
    const line3 = `${assistantLine("msg_3")}\n`;
    await writeFile(filePath, line1 + line2);
    const fileAfterFirstAppend = registeredFile(filePath, Buffer.byteLength(line1 + line2));
    const firstChange = tailer.onFileChanged(fileAfterFirstAppend);

    await writeFile(filePath, line1 + line2 + line3);
    const fileAfterSecondAppend = registeredFile(
      filePath,
      Buffer.byteLength(line1 + line2 + line3),
    );
    const secondChange = tailer.onFileChanged(fileAfterSecondAppend);

    await Promise.all([firstChange, secondChange]);

    const allMessageIds = records.flatMap((r) => r.result.calls.map((c) => c.messageId));
    expect(allMessageIds).toEqual(["msg_1", "msg_2", "msg_3"]);
  });

  it("survives the file disappearing before open", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    await writeFile(filePath, `${assistantLine("msg_1")}\n`);

    const { records, resets, events } = collectEvents();
    const tailer = new Tailer(events);
    const staleFile = registeredFile(filePath, Buffer.byteLength(`${assistantLine("msg_1")}\n`));

    await unlink(filePath);
    await expect(tailer.onFileChanged(staleFile)).resolves.not.toThrow();

    expect(records).toHaveLength(0);
    expect(resets).toHaveLength(0);
  });
});
