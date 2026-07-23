import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("parses non-empty C/L premium content and threads observed values into the session (#P4-13)", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionId = "ffffffff-1111-4111-8111-111111111111";
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      `${userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n${assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z")}\n`,
      "utf8",
    );
    // C sample attributed to the single call (timestamp just after it).
    await writeFile(
      join(projectDir, `${sessionId}.cost.jsonl`),
      `${JSON.stringify({
        session_id: sessionId,
        timestamp: "2026-07-14T00:00:02.000Z",
        cost_delta_usd: 0.42,
        cumulative_cost_usd: 0.42,
        api_duration_ms: 5200,
        context_pct: 27,
        lines_added: 7,
        lines_removed: 3,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        turn: 1,
      })}\n`,
      "utf8",
    );
    // L file lives at the claudeDir root (parent of projects/).
    await writeFile(
      join(claudeDir, "cost-log.jsonl"),
      `${JSON.stringify({
        session_id: sessionId,
        timestamp: "2026-07-14T00:00:03.000Z",
        cost_usd: 0.99,
        duration_ms: 6000,
        model: "claude-sonnet-5",
        dir: "/repo",
        context_pct: 30,
        cache_read: 0,
        cache_write: 0,
        lines_added: 7,
        lines_removed: 3,
      })}\n`,
      "utf8",
    );

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

    const session = pipeline.store.getSession(sessionId);
    expect(session?.tier.costBasis).toBe("observed");
    expect(session?.tier).toMatchObject({ hasCostSamples: true, hasCostLog: true });
    // C wins over L for costObserved (0.42, not L's 0.99).
    expect(session?.costObserved).toBeCloseTo(0.42);
    expect(session?.linesAdded).toBe(7);
    expect(session?.contextPctObserved).toBeCloseTo(0.27);
    // Observed apiMs is attributed onto the fleet-visible call.
    expect(pipeline.store.getCalls(sessionId)[0]?.apiMs).toBe(5200);
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

function sidechainLine(sessionId: string, messageId: string, timestamp: string, agentId: string) {
  return JSON.stringify({
    type: "assistant",
    uuid: `u-${messageId}`,
    sessionId,
    timestamp,
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    isSidechain: true,
    agentId,
    message: {
      id: messageId,
      model: "claude-sonnet-5",
      content: [],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });
}

describe("startIngest — sub-agent transcripts route to the parent session (#113)", () => {
  it("folds subagents/agent-*.jsonl into the parent, creating no phantom session", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    const sessionId = "84509ee5-2c27-4bec-a113-4fab01758d38";
    await mkdir(join(projectDir, sessionId, "subagents"), { recursive: true });
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      `${[
        userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi"),
        assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z"),
      ].join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      join(projectDir, sessionId, "subagents", "agent-aa25.jsonl"),
      `${sidechainLine(sessionId, "m2", "2026-07-14T00:00:02.000Z", "aa25")}\n`,
      "utf8",
    );

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 50,
          slowIntervalMs: 5000,
        },
        { onInvalidate: () => {}, debounceMs: 50 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();

    // Both files' calls land on the one real session...
    expect(pipeline.store.getSession(sessionId)?.callCount).toBe(2);
    // ...and no `agent-*` phantom session exists.
    const ids = pipeline.store.listSessions().map((s) => s.sessionId);
    expect(ids).toEqual([sessionId]);
    // The session's transcript path stays pinned to the parent file.
    expect(pipeline.store.getTranscriptPath(sessionId)).toBe(
      join(projectDir, `${sessionId}.jsonl`),
    );
  });

  it("replays sibling files when one file of the session truncates", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    const sessionId = "84509ee5-2c27-4bec-a113-4fab01758d38";
    await mkdir(join(projectDir, sessionId, "subagents"), { recursive: true });
    const parentPath = join(projectDir, `${sessionId}.jsonl`);
    const agentPath = join(projectDir, sessionId, "subagents", "agent-aa25.jsonl");
    await writeFile(
      parentPath,
      `${[
        userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi"),
        assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z"),
      ].join("\n")}\n`,
      "utf8",
    );
    // Two sidechain calls, so the rewrite below is strictly fewer bytes and
    // the tailer takes its `file.size < state.offset` truncation branch.
    await writeFile(
      agentPath,
      `${[
        sidechainLine(sessionId, "m2", "2026-07-14T00:00:02.000Z", "aa25"),
        sidechainLine(sessionId, "m3", "2026-07-14T00:00:03.000Z", "aa25"),
      ].join("\n")}\n`,
      "utf8",
    );

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 50,
          slowIntervalMs: 5000,
        },
        { onInvalidate: () => {}, debounceMs: 50 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();
    expect(pipeline.store.getSession(sessionId)?.callCount).toBe(3);

    // Truncate ONLY the agent file, down to a single call. The shared session
    // is reset by that file's truncation; without the sibling replay the
    // parent transcript's call would be dropped and never re-read, leaving 1.
    await writeFile(
      agentPath,
      `${sidechainLine(sessionId, "m4", "2026-07-14T00:00:04.000Z", "aa25")}\n`,
      "utf8",
    );

    await vi.waitFor(
      () => {
        pipeline.store.flushAll();
        expect(pipeline.store.getSession(sessionId)?.callCount).toBe(2);
      },
      { timeout: 5000, interval: 50 },
    );
    // #113 TC-1: assert which calls survived, not just the count — a bug
    // that replayed the wrong sibling or double-counted could still land
    // on the right count by coincidence.
    expect(
      pipeline.store
        .getCalls(sessionId)
        .map((c) => c.messageId)
        .sort(),
    ).toEqual(["m1", "m4"]);
  });

  it("replays every sibling in a 3+ file group, not just the first (#113 TC-2)", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    const sessionId = "84509ee5-2c27-4bec-a113-4fab01758d38";
    await mkdir(join(projectDir, sessionId, "subagents"), { recursive: true });
    const parentPath = join(projectDir, `${sessionId}.jsonl`);
    const agentAPath = join(projectDir, sessionId, "subagents", "agent-aa.jsonl");
    const agentBPath = join(projectDir, sessionId, "subagents", "agent-bb.jsonl");
    await writeFile(
      parentPath,
      `${[
        userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi"),
        assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z"),
      ].join("\n")}\n`,
      "utf8",
    );
    // Two calls in A, so its rewrite below is strictly fewer bytes and
    // trips the truncation branch (same trick as the single-sibling test).
    await writeFile(
      agentAPath,
      `${[
        sidechainLine(sessionId, "m2", "2026-07-14T00:00:02.000Z", "aa"),
        sidechainLine(sessionId, "m3", "2026-07-14T00:00:03.000Z", "aa"),
      ].join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      agentBPath,
      `${sidechainLine(sessionId, "m4", "2026-07-14T00:00:04.000Z", "bb")}\n`,
      "utf8",
    );

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 50,
          slowIntervalMs: 5000,
        },
        { onInvalidate: () => {}, debounceMs: 50 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();
    expect(pipeline.store.getSession(sessionId)?.callCount).toBe(4);

    // Truncate agent A only. Its reset wipes the WHOLE session, so both the
    // parent's and agent B's data only survive if the sibling-replay loop
    // covers every other file in the group — not just the first one found.
    await writeFile(
      agentAPath,
      `${sidechainLine(sessionId, "m5", "2026-07-14T00:00:05.000Z", "aa")}\n`,
      "utf8",
    );

    await vi.waitFor(
      () => {
        pipeline.store.flushAll();
        expect(pipeline.store.getSession(sessionId)?.callCount).toBe(3);
      },
      { timeout: 5000, interval: 50 },
    );
    expect(
      pipeline.store
        .getCalls(sessionId)
        .map((c) => c.messageId)
        .sort(),
    ).toEqual(["m1", "m4", "m5"]);
  });

  it("evicts a removed file from the session's file group (#113 TC-3)", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    const sessionId = "84509ee5-2c27-4bec-a113-4fab01758d38";
    await mkdir(join(projectDir, sessionId, "subagents"), { recursive: true });
    const parentPath = join(projectDir, `${sessionId}.jsonl`);
    const agentPath = join(projectDir, sessionId, "subagents", "agent-aa25.jsonl");
    await writeFile(
      parentPath,
      `${[
        userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi"),
        assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z"),
      ].join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      agentPath,
      `${sidechainLine(sessionId, "m2", "2026-07-14T00:00:02.000Z", "aa25")}\n`,
      "utf8",
    );

    const pipeline = track(
      startIngest(
        {
          roots: [{ path: join(claudeDir, "projects") }],
          claudeDir,
          fastIntervalMs: 50,
          slowIntervalMs: 50,
        },
        { onInvalidate: () => {}, debounceMs: 50 },
      ),
    );
    await pipeline.whenSettled();
    pipeline.store.flushAll();
    expect(pipeline.store.getSession(sessionId)?.callCount).toBe(2);
    expect(pipeline.getStats(0).transcriptsFound).toBe(2);

    // Delete the agent file. A slow discovery pass notices it's gone and
    // fires onFileRemoved — this is the untested removal path
    // (`forgetSessionFile`, #113 TC-3) that's supposed to evict it from
    // `filesBySession` so a later reset on a sibling doesn't try to
    // replay a file that no longer exists.
    await rm(agentPath);
    await vi.waitFor(
      () => {
        expect(pipeline.getStats(0).transcriptsFound).toBe(1);
      },
      { timeout: 5000, interval: 50 },
    );

    // Truncate the parent — now the session's only remaining file — and
    // confirm its own content comes back correctly afterward, with no
    // corruption from the removed sibling.
    await writeFile(
      parentPath,
      `${userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi")}\n`,
      "utf8",
    );
    await vi.waitFor(
      () => {
        pipeline.store.flushAll();
        expect(pipeline.store.getSession(sessionId)?.callCount).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  });
});
