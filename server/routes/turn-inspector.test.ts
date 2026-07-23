import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiCall, TokenUsage } from "../../shared/types.js";
import type {
  ParseTranscriptResult,
  PromptTextRecord,
  ToolResultBytesRecord,
} from "../ingest/parse-transcript.js";
import { Store } from "../store/store.js";
import { registerTurnInspectorRoute } from "./turn-inspector.js";

let app: FastifyInstance;
let store: Store;

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    ...overrides,
  };
}

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: "2026-07-13T00:00:00.000Z",
    model: "claude-sonnet-5",
    usage: usage({ inputTokens: 10 }),
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function batch(calls: ApiCall[], prompts: PromptTextRecord[] = []): ParseTranscriptResult {
  return {
    calls,
    prompts,
    toolResultBytes: [] as ToolResultBytesRecord[],
    compactions: [],
    rawLines: 0,
    skippedLines: 0,
    duplicateCount: 0,
    malformedCount: 0,
  };
}

beforeEach(async () => {
  store = new Store({
    debounceMs: 0,
    onInvalidate: () => {},
    pricer: (u) => u.inputTokens * 0.001,
  });
  app = Fastify({ logger: false });
  registerTurnInspectorRoute(app, store, {
    pricer: (u) => u.inputTokens * 0.001,
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("GET /api/sessions/:id/turns/:n — known resource", () => {
  it("returns 200 with the projected response when the session and turn exist", async () => {
    store.applyRecords(
      "s1",
      batch(
        [call({ sessionId: "s1", messageId: "m1", timestamp: "2026-07-13T00:00:00.000Z" })],
        [
          {
            sessionId: "s1",
            promptId: "p1",
            text: "hi",
            timestamp: "2026-07-13T00:00:00.000Z",
          },
        ],
      ),
    );
    store.flushAll();
    expect(store.getSession("s1")).toBeDefined();

    const response = await app.inject({ method: "GET", url: "/api/sessions/s1/turns/1" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.sessionId).toBe("s1");
    expect(body.summary.turnNumber).toBe(1);
    expect(body.summary.totalTurns).toBe(1);
    expect(body.waterfall.calls).toHaveLength(1);
    expect(Array.isArray(body.cacheNarrative)).toBe(true);
    expect(Array.isArray(body.sidechainBreakdown.sidechains)).toBe(true);
    expect(body.nav.totalTurns).toBe(1);
    expect(body.meta.costBasis).toBe("computed");
  });
});

describe("GET /api/sessions/:id/turns/:n — error paths", () => {
  it("returns 404 with error='session not found' when the session is unknown", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sessions/unknown/turns/1" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "session not found",
      sessionId: "unknown",
    });
  });

  it("returns 404 with error='turn not found' for an out-of-range turnNumber", async () => {
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();

    const response = await app.inject({ method: "GET", url: "/api/sessions/s1/turns/99" });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe("turn not found");
    expect(body.sessionId).toBe("s1");
    expect(body.turnNumber).toBe(99);
  });

  it("returns 404 with error='turn not found' for a non-numeric turnNumber", async () => {
    // Route validator accepts only digits; letters must not be parsed as
    // "turn 1" via Number coercion.
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();

    const response = await app.inject({ method: "GET", url: "/api/sessions/s1/turns/abc" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("turn not found");
  });

  it("returns 404 with error='turn not found' for a zero/negative turnNumber", async () => {
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();

    for (const url of [
      "/api/sessions/s1/turns/0",
      "/api/sessions/s1/turns/-1",
      "/api/sessions/s1/turns/1.5",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("turn not found");
    }
  });
});

describe("GET /api/sessions/:id/transcript — error paths", () => {
  it("returns 404 'session not found' for an unknown session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/unknown/transcript?turn=1",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "session not found" });
  });

  it("returns 404 'turn not found' for an out-of-range turn", async () => {
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1/transcript?turn=99",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "turn not found", turnNumber: 99 });
  });

  it("returns 404 'turn not found' for a non-numeric turn query", async () => {
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1/transcript?turn=abc",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("turn not found");
  });

  it("returns 404 'turn not found' for a missing turn query", async () => {
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.flushAll();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1/transcript",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("turn not found");
  });

  it("returns 404 'transcript unavailable' when the Store has no transcript path", async () => {
    // Need a prompt record so deriveTurns can bucket the call into a
    // turn; otherwise the route correctly responds with "turn not found"
    // before it ever reaches the transcript-path check.
    store.applyRecords(
      "s1",
      batch(
        [call({ sessionId: "s1", messageId: "m1" })],
        [
          {
            sessionId: "s1",
            promptId: "p1",
            text: "hi",
            timestamp: "2026-07-13T00:00:00.000Z",
          },
        ],
      ),
    );
    store.flushAll();

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1/transcript?turn=1",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "transcript unavailable",
      sessionId: "s1",
      turnNumber: 1,
    });
  });
});

describe("GET /api/sessions/:id/transcript — happy path", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "turn-inspector-route-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 200 with the peeks lines when the transcript file is readable", async () => {
    const transcriptPath = join(dir, "transcript.jsonl");
    // Three transcript lines spanning [00:00:00, 00:00:02] — the route
    // derives the window from the turn's startedAt/endedAt, which we
    // synthesize by feeding the Store three API calls with matching
    // timestamps below.
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-07-13T00:00:00.000Z",
          message: { content: [{ type: "text", text: "Reading now" }] },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-07-13T00:00:01.000Z",
          message: {
            content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/x" } }],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-07-13T00:00:02.000Z",
          message: {
            content: [{ type: "tool_result", tool_use_id: "tu1", content: "body" }],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    store.applyRecords(
      "s1",
      batch(
        [
          call({
            sessionId: "s1",
            messageId: "m1",
            timestamp: "2026-07-13T00:00:00.000Z",
          }),
          call({
            sessionId: "s1",
            messageId: "m2",
            timestamp: "2026-07-13T00:00:01.000Z",
          }),
          call({
            sessionId: "s1",
            messageId: "m3",
            timestamp: "2026-07-13T00:00:02.000Z",
          }),
        ],
        [
          {
            sessionId: "s1",
            promptId: "p1",
            text: "hi",
            timestamp: "2026-07-13T00:00:00.000Z",
          },
        ],
      ),
    );
    store.flushAll();
    store.setTranscriptPath("s1", transcriptPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1/transcript?turn=1",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lines.map((l: { role: string }) => l.role)).toEqual([
      "assistant-text",
      "tool-use",
      "tool-result",
    ]);
    expect(body.truncated).toBe(false);
  });

  it("returns 404 'transcript unavailable' when the file was deleted between discovery and read", async () => {
    // Pre-register a path that no longer exists on disk — the route must
    // surface the honest "moved or removed" 404 instead of throwing.
    const transcriptPath = join(dir, "deleted.jsonl");
    await writeFile(transcriptPath, "", "utf8");

    store.applyRecords(
      "s1",
      batch(
        [call({ sessionId: "s1", messageId: "m1", timestamp: "2026-07-13T00:00:00.000Z" })],
        [
          {
            sessionId: "s1",
            promptId: "p1",
            text: "hi",
            timestamp: "2026-07-13T00:00:00.000Z",
          },
        ],
      ),
    );
    store.flushAll();
    store.setTranscriptPath("s1", transcriptPath);
    await rm(transcriptPath);

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/s1/transcript?turn=1",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "transcript unavailable" });
  });
});
