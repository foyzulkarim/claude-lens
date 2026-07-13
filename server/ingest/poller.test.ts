import { mkdtemp, rm, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestEvents, RegisteredFile } from "./poller.js";
import { Poller } from "./poller.js";

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-poller-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function collectEvents() {
  const added: RegisteredFile[] = [];
  const changed: RegisteredFile[] = [];
  const removed: RegisteredFile[] = [];
  const events: IngestEvents = {
    onFileAdded: (f) => added.push(f),
    onFileChanged: (f) => changed.push(f),
    onFileRemoved: (f) => removed.push(f),
  };
  return { added, changed, removed, events };
}

describe("Poller — discovery reconciliation", () => {
  it("registers a newly discovered file", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const sessionId = "11111111-1111-4111-8111-111111111111";
    await writeFile(join(root, `${sessionId}.jsonl`), "hello");

    const { added, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      path: join(root, `${sessionId}.jsonl`),
      class: "transcript",
      sessionId,
    });
    expect(added[0].size).toBe(5);
  });

  it("picks up a file added after boot within one slow-loop pass", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    await writeFile(join(root, "11111111-1111-4111-8111-111111111111.jsonl"), "a");

    const { added, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();
    expect(added).toHaveLength(1);

    await writeFile(join(root, "22222222-2222-4222-8222-222222222222.jsonl"), "b");
    await poller.runDiscovery();

    expect(added).toHaveLength(2);
    expect(added[1].sessionId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("prunes a deleted file on the next discovery pass", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const filePath = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
    await writeFile(filePath, "a");

    const { removed, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();

    await unlink(filePath);
    await poller.runDiscovery();

    expect(removed).toHaveLength(1);
    expect(removed[0].path).toBe(filePath);

    await poller.runDiscovery();
    expect(removed).toHaveLength(1);
  });

  it("dedupes overlapping roots", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    await writeFile(join(root, "11111111-1111-4111-8111-111111111111.jsonl"), "a");

    const { added, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }, { path: root }], claudeDir }, events);
    await poller.runDiscovery();

    expect(added).toHaveLength(1);
  });

  it("boots cleanly on a missing/empty root", async () => {
    const claudeDir = await makeTmpDir();
    const { added, events } = collectEvents();
    const poller = new Poller(
      { roots: [{ path: join(tmpdir(), "claude-lens-missing-xyz") }], claudeDir },
      events,
    );

    expect(() => poller.start()).not.toThrow();
    poller.stop();
    await poller.runDiscovery();
    expect(added).toHaveLength(0);
  });
});

describe("Poller — fast-loop stat detection", () => {
  it("detects growth", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const filePath = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
    await writeFile(filePath, "a");

    const { changed, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();

    await writeFile(filePath, "aaaaa");
    await poller.pollOnce();

    expect(changed).toHaveLength(1);
    expect(changed[0].size).toBe(5);
  });

  it("stays silent with no change", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    await writeFile(join(root, "11111111-1111-4111-8111-111111111111.jsonl"), "a");

    const { changed, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();
    await poller.pollOnce();

    expect(changed).toHaveLength(0);
  });

  it("survives a file deleted between registration and stat", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const filePath = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
    await writeFile(filePath, "a");

    const { changed, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();

    await unlink(filePath);
    await expect(poller.pollOnce()).resolves.not.toThrow();

    expect(changed).toHaveLength(0);
  });

  it("reports truncation as a change, not a special case", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();
    const filePath = join(root, "11111111-1111-4111-8111-111111111111.jsonl");
    await writeFile(filePath, "aaaaaaaaaa");

    const { changed, events } = collectEvents();
    const poller = new Poller({ roots: [{ path: root }], claudeDir }, events);
    await poller.runDiscovery();

    await truncate(filePath, 2);
    await poller.pollOnce();

    expect(changed).toHaveLength(1);
    expect(changed[0].size).toBe(2);
  });
});

describe("Poller — timer lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() schedules both loops", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();

    const { events } = collectEvents();
    const poller = new Poller(
      { roots: [{ path: root }], claudeDir, fastIntervalMs: 100, slowIntervalMs: 1000 },
      events,
    );
    const pollOnceSpy = vi.spyOn(poller, "pollOnce").mockResolvedValue(undefined);
    const runDiscoverySpy = vi.spyOn(poller, "runDiscovery").mockResolvedValue(undefined);

    poller.start();
    expect(runDiscoverySpy).toHaveBeenCalledTimes(1); // initial discovery on start()

    await vi.advanceTimersByTimeAsync(100);
    expect(pollOnceSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(900);
    expect(runDiscoverySpy).toHaveBeenCalledTimes(2); // initial + first slow tick

    poller.stop();
  });

  it("stop() halts both loops", async () => {
    const root = await makeTmpDir();
    const claudeDir = await makeTmpDir();

    const { events } = collectEvents();
    const poller = new Poller(
      { roots: [{ path: root }], claudeDir, fastIntervalMs: 100, slowIntervalMs: 1000 },
      events,
    );
    const pollOnceSpy = vi.spyOn(poller, "pollOnce").mockResolvedValue(undefined);
    const runDiscoverySpy = vi.spyOn(poller, "runDiscovery").mockResolvedValue(undefined);

    poller.start();
    await vi.advanceTimersByTimeAsync(1000);
    const pollCallsBeforeStop = pollOnceSpy.mock.calls.length;
    const discoveryCallsBeforeStop = runDiscoverySpy.mock.calls.length;

    poller.stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(pollOnceSpy).toHaveBeenCalledTimes(pollCallsBeforeStop);
    expect(runDiscoverySpy).toHaveBeenCalledTimes(discoveryCallsBeforeStop);
  });
});
