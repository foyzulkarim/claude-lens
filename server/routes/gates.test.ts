import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import { buildApp } from "../app.js";
import type { PromptTextRecord } from "../ingest/parse-transcript.js";
import { buildRuntimeMetadata } from "../runtime.js";
import { Store } from "../store/store.js";

function iso(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): string {
  return new Date(y, mo, d, h, mi, s).toISOString();
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: iso(2026, 6, 14, 10, 0),
    model: "claude-sonnet-5",
    usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo/alpha",
    gitBranch: "main",
    version: "1.2.3",
    entrypoint: "cli",
    ...overrides,
  };
}

function prompt(
  sessionId: string,
  promptId: string,
  text: string,
  beforeTs: string,
): PromptTextRecord {
  const t = new Date(Date.parse(beforeTs) - 60_000).toISOString();
  return { sessionId, promptId, text, timestamp: t };
}

let projectDir: string;
let userDir: string;
let configDir: string;
let app: FastifyInstance;
let store: Store;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "claude-lens-gates-route-project-"));
  userDir = await mkdtemp(join(tmpdir(), "claude-lens-gates-route-user-"));
  configDir = await mkdtemp(join(tmpdir(), "claude-lens-gates-route-config-"));
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(userDir, ".claude"), { recursive: true });
  await writeFile(join(projectDir, "CLAUDE.md"), "# project\n", "utf8");
  const metadata = buildRuntimeMetadata();
  store = new Store({
    onInvalidate: () => {},
    pricer: metadata.pricer,
    pricing: metadata.pricing,
  });
  // `configPath` must be overridden alongside `userHomeDir` — otherwise
  // the route reads the real `~/.claude-lens/config.json` on whatever
  // machine runs the suite, making threshold-sensitive assertions
  // machine-dependent (review finding: test isolation gap). Pointing at
  // a nonexistent path in a fresh temp dir is safe: `readConfig` treats
  // a missing file as `{ budget: null }`.
  app = buildApp({
    store,
    logger: false,
    metadata,
    userHomeDir: userDir,
    configPath: join(configDir, "config.json"),
  });
});

afterEach(async () => {
  await app.close();
  await rm(configDir, { recursive: true, force: true });
  store.stop();
  await rm(projectDir, { recursive: true, force: true });
  await rm(userDir, { recursive: true, force: true });
});

describe("GET /api/sessions/:id/gates", () => {
  it("returns 404 for an unknown session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions/does-not-exist/gates" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "session not found",
      sessionId: "does-not-exist",
    });
  });

  it("returns a GateReport with 7 gate entries for an existing session", async () => {
    const sessionId = "session-with-data";
    store.applyRecords(sessionId, {
      calls: [call({ sessionId, messageId: "m1", timestamp: iso(2026, 6, 14, 10, 0) })],
      prompts: [prompt(sessionId, "p1", "Hello", iso(2026, 6, 14, 10, 0))],
      toolResultBytes: [],
      compactions: [],
      rawLines: 0,
      skippedLines: 0,
      duplicateCount: 0,
      malformedCount: 0,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/gates`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.sessionId).toBe(sessionId);
    expect(body.gates).toHaveLength(7);
    expect(body.gates.map((g: { gateId: string }) => g.gateId)).toEqual([
      "V1",
      "V2",
      "P3",
      "C3",
      "K2",
      "E1",
      "E2",
    ]);
    expect(typeof body.score).toBe("number");
    expect(["A", "B", "C", "D", "F"]).toContain(body.scoreLetter);
    expect(body.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.thresholdsUsed).toBeDefined();
  });

  it("returns 500 with the documented { error, cause } shape when the engine throws (review H2)", async () => {
    // Force the underlying store read to throw — simulating any future
    // engine / IO failure that escapes the engine's contract of
    // "never throws on user data". We swap `getSessionSnapshot` for
    // the duration of this request via `vi.spyOn` so the rest of the
    // suite isn't disturbed.
    const sessionId = "boom";
    const boom = new Error("synthetic engine failure for test");
    const spy = vi.spyOn(store, "getSessionSnapshot").mockImplementation(() => {
      throw boom;
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}/gates`,
      });
      expect(response.statusCode).toBe(500);
      const body = response.json();
      // ARCH §HTTP errors contract: `{ error, cause, sessionId }` — the
      // route's local try/catch handles engine-escaped errors before the
      // top-level setErrorHandler runs, so the body carries the session
      // id (helps the UI cross-reference the failed report).
      expect(body).toMatchObject({
        error: "failed to evaluate gates",
        cause: boom.message,
        sessionId,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
