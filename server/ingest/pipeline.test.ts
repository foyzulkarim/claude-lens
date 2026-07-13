import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import type { IngestPipeline } from "./pipeline.js";
import { startIngest } from "./pipeline.js";

const tmpDirs: string[] = [];
const pipelines: IngestPipeline[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-pipeline-"));
  tmpDirs.push(dir);
  return dir;
}

function track(pipeline: IngestPipeline): IngestPipeline {
  pipelines.push(pipeline);
  return pipeline;
}

afterEach(async () => {
  // Stop every pipeline started this test — including on assertion failure,
  // when a stray real setInterval/setTimeout would otherwise leak into the
  // next test's run (this file uses real timers and real fs I/O).
  for (const pipeline of pipelines.splice(0)) pipeline.stop();
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function assistantLine(sessionId: string, messageId: string, timestamp: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `u-${messageId}`,
    sessionId,
    timestamp,
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    isSidechain: false,
    message: {
      id: messageId,
      model: "claude-sonnet-5",
      content: [],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });
}

function userLine(sessionId: string, promptId: string, timestamp: string, text: string): string {
  return JSON.stringify({
    type: "user",
    sessionId,
    promptId,
    timestamp,
    message: { role: "user", content: text },
  });
}

describe("startIngest — end-to-end wiring", () => {
  it("discovers a transcript, tails it, and populates the store", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const lines = [
      userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi"),
      assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z"),
    ];
    await writeFile(join(projectDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");

    const invalidations: WsServerMessage[] = [];
    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 50,
          slowIntervalMs: 5000,
        },
        { onInvalidate: (m) => invalidations.push(m), debounceMs: 50 },
      ),
    );

    await pipeline.whenSettled();
    pipeline.store.flushAll();

    const session = pipeline.store.getSession(sessionId);
    expect(session?.callCount).toBe(1);
    expect(invalidations).toContainEqual({ type: "session-added", sessionId });
    expect(invalidations).toContainEqual({ type: "session-updated", sessionId });
  });

  it("picks up an appended line via the poller/tailer path without touching other sessions", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionA = "aaaaaaaa-1111-4111-8111-111111111111";
    const sessionB = "bbbbbbbb-1111-4111-8111-111111111111";
    await writeFile(
      join(projectDir, `${sessionA}.jsonl`),
      `${userLine(sessionA, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionA, "m1", "2026-07-14T00:00:01.000Z")}\n`,
      "utf8",
    );
    await writeFile(
      join(projectDir, `${sessionB}.jsonl`),
      `${userLine(sessionB, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionB, "m1", "2026-07-14T00:00:01.000Z")}\n`,
      "utf8",
    );

    const invalidations: WsServerMessage[] = [];
    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(projectDir, "..") }],
          claudeDir,
          fastIntervalMs: 30,
          slowIntervalMs: 5000,
        },
        { onInvalidate: (m) => invalidations.push(m), debounceMs: 30 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();

    const sessionBBefore = pipeline.store.getSession(sessionB);

    // Append a second call to session A only, and wait for the fast poll to pick it up.
    await writeFile(
      join(projectDir, `${sessionA}.jsonl`),
      `${userLine(sessionA, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionA, "m1", "2026-07-14T00:00:01.000Z")}\n${assistantLine(sessionA, "m2", "2026-07-14T00:00:02.000Z")}\n`,
      "utf8",
    );

    await waitFor(() => pipeline.store.getSession(sessionA)?.callCount === 2, 3000);

    expect(pipeline.store.getSession(sessionA)?.callCount).toBe(2);
    expect(pipeline.store.getSession(sessionB)).toEqual(sessionBBefore);
  });

  it("wires a discovered cost sidecar file to the session's tier flags, isolated per session", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionWithCost = "cccccccc-1111-4111-8111-111111111111";
    const sessionWithout = "dddddddd-1111-4111-8111-111111111111";
    await writeFile(
      join(projectDir, `${sessionWithCost}.jsonl`),
      `${userLine(sessionWithCost, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionWithCost, "m1", "2026-07-14T00:00:01.000Z")}\n`,
      "utf8",
    );
    await writeFile(
      join(projectDir, `${sessionWithout}.jsonl`),
      `${userLine(sessionWithout, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionWithout, "m1", "2026-07-14T00:00:01.000Z")}\n`,
      "utf8",
    );
    // Sidecar filenames are dot-separated: <sessionId>.cost.jsonl.
    await writeFile(join(projectDir, `${sessionWithCost}.cost.jsonl`), "", "utf8");

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 50,
          slowIntervalMs: 5000,
        },
        { onInvalidate: () => {}, debounceMs: 30 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();

    expect(pipeline.store.getSession(sessionWithCost)?.tier).toMatchObject({
      hasCostSamples: true,
    });
    expect(pipeline.store.getSession(sessionWithout)?.tier).toMatchObject({
      hasCostSamples: false,
    });
  });

  it("resets a session's accumulated state when its transcript file is truncated and rewritten", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionId = "eeeeeeee-1111-4111-8111-111111111111";
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    await writeFile(
      filePath,
      `${userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z")}\n${assistantLine(sessionId, "m2", "2026-07-14T00:00:02.000Z")}\n`,
      "utf8",
    );

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 30,
          slowIntervalMs: 5000,
        },
        { onInvalidate: () => {}, debounceMs: 30 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();
    expect(pipeline.store.getSession(sessionId)?.callCount).toBe(2);

    // Truncate to a single, different call — simulates a compacted/rewritten transcript.
    await writeFile(
      filePath,
      `${userLine(sessionId, "p2", "2026-07-14T01:00:00.000Z", "restart")}\n${assistantLine(sessionId, "m3", "2026-07-14T01:00:01.000Z")}\n`,
      "utf8",
    );

    await waitFor(() => pipeline.store.getCalls(sessionId).length === 1, 3000);
    pipeline.store.flushAll();

    expect(pipeline.store.getSession(sessionId)?.callCount).toBe(1);
    expect(pipeline.store.getCalls(sessionId).map((c) => c.messageId)).toEqual(["m3"]);
  });

  it("stop() called before whenSettled() resolves prevents the poller's timers from ever starting", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionId = "ffffffff-1111-4111-8111-111111111111";
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    await writeFile(
      filePath,
      `${userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z")}\n`,
      "utf8",
    );

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 30,
          slowIntervalMs: 5000,
        },
        { onInvalidate: () => {}, debounceMs: 30 },
      ),
    );
    // Stop immediately — before the initial discovery/drain (still in flight)
    // has had any chance to resolve. The fix under test: this must prevent
    // poller.start() from firing once that in-flight work finishes, not just
    // clear timers that don't exist yet. stop() also freezes the store's
    // invalidator immediately, so the in-flight read's data lands in the raw
    // call arrays (getCalls) but never gets a derived Session (getSession
    // requires a recompute, which requires a flush, which stop() forecloses)
    // — that's the intended "hard boundary" behavior, not a gap.
    pipeline.stop();
    await pipeline.whenSettled();

    // The in-flight initial discovery/tail still completes (it isn't
    // cancelable), so the file present at boot is ingested once.
    expect(pipeline.store.getCalls(sessionId)).toHaveLength(1);

    // Append a second call and wait well past fastIntervalMs. If the poller's
    // timers had started despite stop(), this would be picked up.
    await writeFile(
      filePath,
      `${userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z")}\n${assistantLine(sessionId, "m2", "2026-07-14T00:00:02.000Z")}\n`,
      "utf8",
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(pipeline.store.getCalls(sessionId)).toHaveLength(1);
  });
});

// Minimal polling-based waitFor since fake timers can't be used here (the
// pipeline's poller/tailer chain does real filesystem I/O between ticks).
async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
