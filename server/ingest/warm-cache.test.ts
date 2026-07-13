import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import type { WarmCacheEntry, WarmCacheKey } from "./warm-cache.js";
import { createWarmCache } from "./warm-cache.js";

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-warm-cache-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sampleCall(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: "u1",
    sessionId: "s1",
    messageId: "m1",
    timestamp: "2026-07-13T00:00:00.000Z",
    model: "claude-sonnet-5",
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function sampleEntry(overrides: Partial<WarmCacheEntry> = {}): WarmCacheEntry {
  return {
    calls: [sampleCall()],
    prompts: [
      { sessionId: "s1", promptId: "p1", text: "hello", timestamp: "2026-07-13T00:00:00.000Z" },
    ],
    toolResultBytes: [{ sessionId: "s1", promptId: "p1", toolUseId: "t1", bytes: 42 }],
    duplicateCount: 0,
    malformedCount: 0,
    ...overrides,
  };
}

describe("createWarmCache — round trip", () => {
  it("returns the saved entry when key matches exactly", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/session.jsonl", size: 100, mtime: 123456 };
    const entry = sampleEntry();

    await cache.save(key, entry);
    const loaded = await cache.load(key);

    expect(loaded).toEqual(entry);
  });

  it("creates the cache directory lazily on first save", async () => {
    const dir = await makeTmpDir();
    const cacheDir = join(dir, "nested", "cache");
    const cache = createWarmCache(cacheDir);
    const key: WarmCacheKey = { path: "/fake/a.jsonl", size: 1, mtime: 1 };

    await cache.save(key, sampleEntry());
    const loaded = await cache.load(key);

    expect(loaded).toEqual(sampleEntry());
  });
});

describe("createWarmCache — cache miss conditions", () => {
  it("returns null when no entry exists for the path", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);

    const loaded = await cache.load({ path: "/fake/none.jsonl", size: 1, mtime: 1 });

    expect(loaded).toBeNull();
  });

  it("returns null when size differs from the cached header", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/b.jsonl", size: 100, mtime: 1 };
    await cache.save(key, sampleEntry());

    const loaded = await cache.load({ ...key, size: 200 });

    expect(loaded).toBeNull();
  });

  it("returns null when mtime differs from the cached header", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/c.jsonl", size: 100, mtime: 1 };
    await cache.save(key, sampleEntry());

    const loaded = await cache.load({ ...key, mtime: 2 });

    expect(loaded).toBeNull();
  });

  it("returns null when the cache file contains malformed JSON", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/d.jsonl", size: 100, mtime: 1 };
    await cache.save(key, sampleEntry());

    const files = await readdir(dir);
    const cacheFile = join(dir, files[0] ?? "");
    await writeFile(cacheFile, "not json at all\nnope\n", "utf8");

    const loaded = await cache.load(key);

    expect(loaded).toBeNull();
  });

  it("returns null when a record line has an unrecognized kind", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/e.jsonl", size: 100, mtime: 1 };

    // Round-trip through save() first so the cache filename derivation matches,
    // then overwrite the file's content with a bad record line.
    await cache.save(key, sampleEntry());
    const files = await readdir(dir);
    const cacheFile = join(dir, files[0] ?? "");
    const raw = `${JSON.stringify(key)}\n${JSON.stringify({ kind: "mystery", value: 1 })}\n`;
    await writeFile(cacheFile, raw, "utf8");

    const loaded = await cache.load(key);

    expect(loaded).toBeNull();
  });

  it("returns null when the cache file is empty", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/h.jsonl", size: 100, mtime: 1 };

    // Round-trip through save() first so the cache filename derivation matches,
    // then truncate the file to simulate a write interrupted before any bytes landed.
    await cache.save(key, sampleEntry());
    const files = await readdir(dir);
    const cacheFile = join(dir, files[0] ?? "");
    await writeFile(cacheFile, "", "utf8");

    const loaded = await cache.load(key);

    expect(loaded).toBeNull();
  });

  it("returns null when a call record is missing required fields", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const key: WarmCacheKey = { path: "/fake/i.jsonl", size: 100, mtime: 1 };

    // Round-trip through save() first so the cache filename derivation matches,
    // then overwrite with a "call" record shape missing messageId.
    await cache.save(key, sampleEntry());
    const files = await readdir(dir);
    const cacheFile = join(dir, files[0] ?? "");
    const raw = `${JSON.stringify(key)}\n${JSON.stringify({ kind: "call", call: { uuid: "u1" } })}\n`;
    await writeFile(cacheFile, raw, "utf8");

    const loaded = await cache.load(key);

    expect(loaded).toBeNull();
  });
});

describe("createWarmCache — write resilience", () => {
  it("save() resolves without throwing when the write target is unwritable", async () => {
    if (platform() === "win32") return;
    const dir = await makeTmpDir();
    const blockedFile = join(dir, "blocked-cache-dir");
    await writeFile(blockedFile, "im a file not a dir", "utf8");
    // Use the file itself as the cache "directory" — mkdir/rename underneath it must fail.
    const cache = createWarmCache(join(blockedFile, "cache"));

    await expect(
      cache.save({ path: "/fake/f.jsonl", size: 1, mtime: 1 }, sampleEntry()),
    ).resolves.toBeUndefined();
  });

  it("save() resolves without throwing when permissions deny writes", async () => {
    if (platform() === "win32") return;
    const dir = await makeTmpDir();
    const cacheDir = join(dir, "cache");
    await mkdir(cacheDir, { recursive: true });
    await chmod(cacheDir, 0o400);
    const cache = createWarmCache(cacheDir);

    try {
      await expect(
        cache.save({ path: "/fake/g.jsonl", size: 1, mtime: 1 }, sampleEntry()),
      ).resolves.toBeUndefined();
    } finally {
      await chmod(cacheDir, 0o700);
    }
  });
});

describe("createWarmCache — key isolation", () => {
  it("different paths produce independent cache entries", async () => {
    const dir = await makeTmpDir();
    const cache = createWarmCache(dir);
    const keyA: WarmCacheKey = { path: "/fake/session-a.jsonl", size: 10, mtime: 1 };
    const keyB: WarmCacheKey = { path: "/fake/session-b.jsonl", size: 10, mtime: 1 };
    const entryA = sampleEntry({ calls: [sampleCall({ messageId: "a" })] });
    const entryB = sampleEntry({ calls: [sampleCall({ messageId: "b" })] });

    await cache.save(keyA, entryA);
    await cache.save(keyB, entryB);

    await expect(cache.load(keyA)).resolves.toEqual(entryA);
    await expect(cache.load(keyB)).resolves.toEqual(entryB);
  });
});
