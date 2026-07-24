import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WsServerMessage } from "../shared/ws-protocol.js";
import { buildApp, isAllowedOrigin } from "./app.js";
import type { IngestPipeline } from "./ingest/pipeline.js";
import { startIngest } from "./ingest/pipeline.js";
import * as observability from "./observability.js";
import { Store } from "./store/store.js";
import { createBroadcaster } from "./ws/broadcaster.js";

// End-to-end acceptance for #P3-1: an append to a watched transcript file must
// surface as exactly one debounced `session-updated` on a connected WS client.
// Real fs I/O + real timers + a real socket — mirrors ingest/pipeline.test.ts's
// harness (short poll/debounce intervals, whenSettled(), polling waitFor).

const tmpDirs: string[] = [];
const pipelines: IngestPipeline[] = [];
const stores: Store[] = [];
const apps: FastifyInstance[] = [];
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const pipeline of pipelines.splice(0)) pipeline.stop();
  for (const store of stores.splice(0)) store.stop();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "claude-lens-app-"));
  tmpDirs.push(dir);
  return dir;
}

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

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Node's global WebSocket client (browser-style API) — avoids a dev dependency
// on `ws`'s types just for the test.
function openClient(url: string, onMessage: (m: WsServerMessage) => void): Promise<WebSocket> {
  const client = new WebSocket(url);
  clients.push(client);
  client.addEventListener("message", (event) => {
    onMessage(JSON.parse(String(event.data)) as WsServerMessage);
  });
  return new Promise((resolve, reject) => {
    client.addEventListener("open", () => resolve(client));
    client.addEventListener("error", () => reject(new Error("WS client connection error")));
  });
}

describe("buildApp — ingest → WS invalidation bus (#P3-1)", () => {
  it("emits one debounced session-updated over WS when a watched file is appended to", async () => {
    const claudeDir = await makeTmpDir();
    const projectDir = join(claudeDir, "projects", "alpha");
    await mkdir(projectDir, { recursive: true });

    const sessionId = "11111111-1111-4111-8111-111111111111";
    const filePath = join(projectDir, `${sessionId}.jsonl`);
    const baseLines = [
      userLine(sessionId, "p1", "2026-07-14T00:00:00.000Z", "hi"),
      assistantLine(sessionId, "m1", "2026-07-14T00:00:01.000Z"),
    ];
    await writeFile(filePath, `${baseLines.join("\n")}\n`, "utf8");

    const broadcaster = createBroadcaster();
    const ingest = startIngest(
      {
        roots: [{ path: join(claudeDir, "projects") }],
        claudeDir,
        fastIntervalMs: 30,
        slowIntervalMs: 5000,
      },
      { onInvalidate: broadcaster.broadcast, debounceMs: 30 },
    );
    pipelines.push(ingest);

    const app = buildApp({ store: ingest.store, broadcaster, logger: false });
    apps.push(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;

    // Drain the boot session-added/session-updated for the pre-existing file
    // *before* any client connects, so they aren't counted.
    await ingest.whenSettled();
    ingest.store.flushAll();

    const received: WsServerMessage[] = [];
    await openClient(`ws://127.0.0.1:${port}/ws`, (m) => received.push(m));

    // Append a second assistant call — a true append (not a truncate+rewrite),
    // matching how Claude Code grows a transcript. The session is already known,
    // so this produces a single debounced session-updated and no session-added.
    // (A full-file writeFile here would open with O_TRUNC; under load the fast
    // poll can catch the transient size-0 state and read it as a reset+refill,
    // yielding two flushes — see the tailer's file-reset path.)
    await appendFile(
      filePath,
      `${assistantLine(sessionId, "m2", "2026-07-14T00:00:02.000Z")}\n`,
      "utf8",
    );

    await waitFor(() => received.length >= 1, 3000);
    // Give any erroneous duplicate a chance to arrive before asserting exactly one.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(received).toEqual([{ type: "session-updated", sessionId }]);
  });

  it("registers a connected socket and removes it when the client disconnects", async () => {
    // No ingest needed — this exercises only the /ws connect/close wiring in
    // app.ts against the broadcaster's live socket set.
    const broadcaster = createBroadcaster();
    const store = new Store({ onInvalidate: () => {} });
    stores.push(store);
    const app = buildApp({ store, broadcaster, logger: false });
    apps.push(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;

    const client = await openClient(`ws://127.0.0.1:${port}/ws`, () => {});
    await waitFor(() => broadcaster.size() === 1, 1000);
    expect(broadcaster.size()).toBe(1);

    client.close();
    await waitFor(() => broadcaster.size() === 0, 1000);
    expect(broadcaster.size()).toBe(0);
  });
});

describe("isAllowedOrigin — /ws origin allowlist", () => {
  it("allows loopback origins and rejects everything else", () => {
    expect(isAllowedOrigin("http://localhost:4128")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:4128")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:4128")).toBe(true);
    // A non-loopback host, a rebind-style hostname that merely contains a
    // loopback IP, and unparseable input all reject.
    expect(isAllowedOrigin("http://evil.com")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.com")).toBe(false);
    expect(isAllowedOrigin("not a url")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ARCH-119 T3: event-loop lag monitor lifecycle. Off by default (no interval
// in the test suite); started + stopped via onClose when enabled.
// ---------------------------------------------------------------------------

describe("buildApp — event-loop monitor lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts the monitor on ready (with the app's own logger) and stops it on close", async () => {
    const stop = vi.fn();
    const spy = vi.spyOn(observability, "startEventLoopMonitor").mockReturnValue({ stop });
    const store = new Store({ onInvalidate: () => {} });
    stores.push(store);

    const app = buildApp({ store, logger: false, enableEventLoopMonitor: true });
    // Deferred to `onReady`: a build that throws must not leave a monitor
    // running with no owner, since `app.close()` is unreachable then.
    expect(spy).not.toHaveBeenCalled();

    await app.ready();
    expect(spy).toHaveBeenCalledTimes(1);
    // Not merely "called" — called with the app's logger, so a wrong logger
    // (warns going nowhere in production) fails here.
    expect(spy).toHaveBeenCalledWith(app.log);

    await app.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not start the monitor by default", async () => {
    const spy = vi.spyOn(observability, "startEventLoopMonitor");
    const store = new Store({ onInvalidate: () => {} });
    stores.push(store);

    const app = buildApp({ store, logger: false });
    apps.push(app);
    await app.ready();

    expect(spy).not.toHaveBeenCalled();
  });

  it("wires the real monitor and leaves no timer behind after close", async () => {
    const store = new Store({ onInvalidate: () => {} });
    stores.push(store);

    // No mock on the monitor itself: the real perf_hooks-backed one runs, and
    // we watch the timer it creates. Asserting only that close() resolves
    // would still pass with both the `unref` and the onClose hook removed —
    // these two assertions fail in that case, which is the point.
    // (`process.getActiveResourcesInfo()` can't serve here: it deliberately
    // omits unref'd handles, so the interval is invisible to it either way.)
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");

    const app = buildApp({ store, logger: false, enableEventLoopMonitor: true });
    await app.ready();

    const sampled = setSpy.mock.calls.findIndex(
      ([, delay]) => delay === observability.EVENT_LOOP_SAMPLE_MS,
    );
    expect(sampled).toBeGreaterThanOrEqual(0);
    const handle = setSpy.mock.results[sampled]?.value as ReturnType<typeof setInterval>;
    expect(handle.hasRef()).toBe(false); // unref'd — never holds the process open

    await expect(app.close()).resolves.toBeUndefined();
    expect(clearSpy).toHaveBeenCalledWith(handle); // onClose actually cleared it
  });

  // `cli.ts` boots a real server (ports, ingest, signal handlers), so it has
  // no unit harness — but R4 only holds in production if that one flag stays
  // wired. Reverting it would otherwise disable lag monitoring with a fully
  // green suite, so the source text is the guard.
  it("is enabled by cli.ts in production", async () => {
    const source = await readFile(new URL("./cli.ts", import.meta.url), "utf8");
    expect(source).toMatch(/enableEventLoopMonitor:\s*true/);
  });
});
