import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
let app: FastifyInstance;
let store: Store;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "claude-lens-gates-route-project-"));
  userDir = await mkdtemp(join(tmpdir(), "claude-lens-gates-route-user-"));
  await mkdir(projectDir, { recursive: true });
  await mkdir(join(userDir, ".claude"), { recursive: true });
  await writeFile(join(projectDir, "CLAUDE.md"), "# project\n", "utf8");
  const metadata = buildRuntimeMetadata();
  store = new Store({
    onInvalidate: () => {},
    pricer: metadata.pricer,
    pricing: metadata.pricing,
  });
  app = buildApp({ store, logger: false, metadata, userHomeDir: userDir });
});

afterEach(async () => {
  await app.close();
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
});
