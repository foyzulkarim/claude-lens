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
import type { WarmCache, WarmCacheEntry, WarmCacheKey } from "./warm-cache.js";

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

function assistantToolLine(messageId: string, toolUseId: string, toolName: string): string {
  const line = JSON.parse(assistantLine(messageId)) as {
    message: { content: unknown[] };
  };
  line.message.content = [
    { type: "tool_use", id: toolUseId, name: toolName, input: { command: "false" } },
  ];
  return JSON.stringify(line);
}

function toolResultLine(toolUseId: string, content: string): string {
  return JSON.stringify({
    type: "user",
    sessionId: "session-1",
    promptId: "prompt-1",
    timestamp: "2026-07-03T04:47:51.065Z",
    isSidechain: false,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  });
}

function stubCache(overrides: Partial<WarmCache> = {}): WarmCache & {
  saved: Array<{ key: WarmCacheKey; entry: WarmCacheEntry }>;
} {
  const saved: Array<{ key: WarmCacheKey; entry: WarmCacheEntry }> = [];
  return {
    saved,
    load: async () => null,
    save: async (key, entry) => {
      saved.push({ key, entry });
    },
    ...overrides,
  };
}

function cachedEntry(messageIds: string[]): WarmCacheEntry {
  return {
    calls: messageIds.map((messageId) => ({
      uuid: `uuid-${messageId}`,
      sessionId: "session-1",
      messageId,
      timestamp: "2026-07-03T04:46:51.065Z",
      model: "claude-sonnet-5",
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0 },
      isSidechain: false,
      tools: [],
      cwd: "/Users/demo/.claude",
      gitBranch: "main",
      version: "2.1.199",
      entrypoint: "cli",
    })),
    prompts: [],
    toolResultBytes: [],
    compactions: [],
    duplicateCount: 0,
    malformedCount: 0,
  };
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

  it("retains Bash tool attribution across incremental read boundaries", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const toolUse = `${assistantToolLine("msg_1", "toolu_incremental", "Bash")}\n`;
    await writeFile(filePath, toolUse);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(toolUse));
    await tailer.onFileAdded(file);

    const toolResult = `${toolResultLine("toolu_incremental", "exit code 7")}\n`;
    await writeFile(filePath, toolUse + toolResult);
    file.size = Buffer.byteLength(toolUse + toolResult);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.toolResultBytes).toHaveLength(1);
    expect(records[1].result.toolResultBytes[0]).toMatchObject({
      toolUseId: "toolu_incremental",
      isError: true,
    });
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

describe("Tailer — warm-cache hit", () => {
  it("skips the transcript read and replays cached records", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);
    const file = registeredFile(filePath, Buffer.byteLength(line1), { mtime: 42 });

    const entry = cachedEntry(["msg_cached"]);
    const cache = stubCache({
      load: async (key) =>
        key.path === filePath && key.size === file.size && key.mtime === file.mtime ? entry : null,
    });

    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);

    // Delete the actual transcript file to prove onFileAdded never reads it on a cache hit.
    await unlink(filePath);
    await tailer.onFileAdded(file);

    expect(records).toHaveLength(1);
    expect(records[0].result).toEqual(entry);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_cached"]);
  });

  it("seeds the dedupe seen-set from cached messageIds", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);
    const file = registeredFile(filePath, Buffer.byteLength(line1), { mtime: 42 });

    const entry = cachedEntry(["msg_1"]);
    const cache = stubCache({ load: async () => entry });

    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);

    // Live growth re-sends msg_1 (already in the cached entry, so it's a
    // duplicate the tailer must recognize via the seeded seen-set) then adds msg_2.
    const duplicateOfCached = `${assistantLine("msg_1")}\n`;
    const newLine = `${assistantLine("msg_2")}\n`;
    await writeFile(filePath, line1 + duplicateOfCached + newLine);
    file.size = Buffer.byteLength(line1 + duplicateOfCached + newLine);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_2"]);
    expect(records[1].result.duplicateCount).toBe(1);
  });

  it("rebuilds Bash tool attribution from cached calls before live growth", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const cachedLine = `${assistantLine("msg_cached")}\n`;
    await writeFile(filePath, cachedLine);
    const file = registeredFile(filePath, Buffer.byteLength(cachedLine), { mtime: 42 });

    const entry = cachedEntry(["msg_cached"]);
    entry.calls[0].tools = [{ id: "toolu_cached", name: "Bash", inputBytes: 18 }];
    const cache = stubCache({ load: async () => entry });
    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);
    await tailer.onFileAdded(file);

    const toolResult = `${toolResultLine("toolu_cached", "exit code 9")}\n`;
    await writeFile(filePath, cachedLine + toolResult);
    file.size = Buffer.byteLength(cachedLine + toolResult);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.toolResultBytes[0]).toMatchObject({
      toolUseId: "toolu_cached",
      isError: true,
    });
  });
});

describe("Tailer — warm-cache miss", () => {
  it("parses normally and writes the result to the cache", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);
    const file = registeredFile(filePath, Buffer.byteLength(line1), { mtime: 42 });

    const cache = stubCache();
    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);
    await tailer.onFileAdded(file);

    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);

    expect(cache.saved).toHaveLength(1);
    expect(cache.saved[0].key).toEqual({ path: filePath, size: file.size, mtime: file.mtime });
    expect(cache.saved[0].entry.calls.map((c) => c.messageId)).toEqual(["msg_1"]);
  });
});

describe("Tailer — warm-cache regression guard", () => {
  it("a Tailer built without a cache behaves exactly as before", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    const line2 = `${assistantLine("msg_2")}\n`;
    await writeFile(filePath, line1);

    const { records, events } = collectEvents();
    const tailer = new Tailer(events);
    const file = registeredFile(filePath, Buffer.byteLength(line1));
    await tailer.onFileAdded(file);
    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);

    await writeFile(filePath, line1 + line2);
    file.size = Buffer.byteLength(line1 + line2);
    await tailer.onFileChanged(file);

    expect(records).toHaveLength(2);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_2"]);
  });

  it("preserves per-file serialization: a cache-hit onFileAdded and a concurrent onFileChanged don't interleave", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    const line2 = `${assistantLine("msg_2")}\n`;
    await writeFile(filePath, line1 + line2);
    const file = registeredFile(filePath, Buffer.byteLength(line1 + line2), { mtime: 42 });

    const entry = cachedEntry(["msg_1", "msg_2"]);
    const cache = stubCache({ load: async () => entry });

    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);

    const added = tailer.onFileAdded(file);
    const line3 = `${assistantLine("msg_3")}\n`;
    await writeFile(filePath, line1 + line2 + line3);
    const grownFile = registeredFile(filePath, Buffer.byteLength(line1 + line2 + line3), {
      mtime: 42,
    });
    const changed = tailer.onFileChanged(grownFile);

    await Promise.all([added, changed]);

    // Cache-hit result must be emitted before the live-growth result, in order.
    expect(records).toHaveLength(2);
    expect(records[0].result).toEqual(entry);
    expect(records[1].result.calls.map((c) => c.messageId)).toEqual(["msg_3"]);
  });
});

describe("Tailer — warm-cache resilience", () => {
  it("a rejecting cache.load falls through to a normal parse without rejecting onFileAdded", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);
    const file = registeredFile(filePath, Buffer.byteLength(line1));

    const cache = stubCache({ load: async () => Promise.reject(new Error("cache broke")) });
    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);

    await expect(tailer.onFileAdded(file)).resolves.toBeUndefined();

    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);
  });
});

describe("Tailer — warm-cache only applies to onFileAdded", () => {
  it("onFileChanged never consults the cache when it is the first event seen for a path", async () => {
    const root = await makeTmpDir();
    const filePath = join(root, "a.jsonl");
    const line1 = `${assistantLine("msg_1")}\n`;
    await writeFile(filePath, line1);
    const file = registeredFile(filePath, Buffer.byteLength(line1), { mtime: 42 });

    let loadCalls = 0;
    let saveCalls = 0;
    const cache = stubCache({
      load: async () => {
        loadCalls++;
        return cachedEntry(["msg_cached"]);
      },
      save: async () => {
        saveCalls++;
      },
    });

    const { records, events } = collectEvents();
    const tailer = new Tailer(events, cache);

    // No onFileAdded call precedes this — pins down today's behavior: only
    // onFileAdded's initialRead consults the cache; onFileChanged never does.
    await tailer.onFileChanged(file);

    expect(loadCalls).toBe(0);
    expect(saveCalls).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].result.calls.map((c) => c.messageId)).toEqual(["msg_1"]);
  });
});
