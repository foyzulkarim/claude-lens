import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { startIngest } from "./pipeline.js";

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-pipeline-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
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
    const pipeline = startIngest(
      {
        roots: [{ path: join(claudeDir, "projects") }],
        claudeDir,
        fastIntervalMs: 50,
        slowIntervalMs: 5000,
      },
      { onInvalidate: (m) => invalidations.push(m), debounceMs: 50 },
    );

    await pipeline.whenSettled();
    pipeline.store.flushAll();

    const session = pipeline.store.getSession(sessionId);
    expect(session?.callCount).toBe(1);
    expect(invalidations).toContainEqual({ type: "session-added", sessionId });
    expect(invalidations).toContainEqual({ type: "session-updated", sessionId });

    pipeline.stop();
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
    const pipeline = startIngest(
      {
        roots: [{ path: join(projectDir, "..") }],
        claudeDir,
        fastIntervalMs: 30,
        slowIntervalMs: 5000,
      },
      { onInvalidate: (m) => invalidations.push(m), debounceMs: 30 },
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

    pipeline.stop();
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
