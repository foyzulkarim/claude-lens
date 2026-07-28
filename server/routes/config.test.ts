import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { Store } from "../store/store.js";

describe("GET/PUT /api/config", () => {
  let app: FastifyInstance;
  let store: Store;
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-lens-config-route-"));
    configPath = join(dir, "config.json");
    store = new Store({ onInvalidate: () => {} });
    app = buildApp({ store, logger: false, configPath });
  });

  afterEach(async () => {
    store.stop();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET returns the default when no config has been written yet", async () => {
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ budget: null });
  });

  it("PUT persists a valid budget and GET reflects it", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ budget: 300 });

    const get = await app.inject({ method: "GET", url: "/api/config" });
    expect(get.json()).toEqual({ budget: 300 });
  });

  it("PUT { budget: null } clears a previously set budget", async () => {
    await app.inject({ method: "PUT", url: "/api/config", payload: { budget: 300 } });
    const put = await app.inject({ method: "PUT", url: "/api/config", payload: { budget: null } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ budget: null });
  });

  it("PUT rejects a negative budget with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: -50 },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json()).toEqual({
      error: "budget must be null or a finite number greater than 0",
    });
  });

  it("PUT rejects a body missing budget with 400", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/config", payload: {} });
    expect(put.statusCode).toBe(400);
  });

  it("PUT rejects a non-object body with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("nope"),
    });
    expect(put.statusCode).toBe(400);
  });

  it("PUT returns a clean 500 (not a hang/crash) when the config file can't be written", async () => {
    const { writeFile } = await import("node:fs/promises");
    // Put a *file* where writeConfig's mkdir(dirname, {recursive:true}) needs a
    // directory, so the write fails with ENOTDIR instead of succeeding.
    const blockerDir = join(dir, "blocked");
    await writeFile(blockerDir, "not a directory", "utf8");
    const brokenApp = buildApp({
      store,
      logger: false,
      configPath: join(blockerDir, "config.json"),
    });

    const put = await brokenApp.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300 },
    });
    expect(put.statusCode).toBe(500);
    expect(put.json()).toEqual({ error: "failed to save config" });

    await brokenApp.close();
  });

  it("PUT accepts gateThresholds alongside budget and persists both (#P4-11)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: {
        budget: 300,
        gateThresholds: { v2Repeat: 5, c3MaxChars: 25_000 },
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      budget: 300,
      gateThresholds: { v2Repeat: 5, c3MaxChars: 25_000 },
    });

    const get = await app.inject({ method: "GET", url: "/api/config" });
    expect(get.json()).toEqual({
      budget: 300,
      gateThresholds: { v2Repeat: 5, c3MaxChars: 25_000 },
    });
  });

  it("PUT { gateThresholds: {} } (empty) resets thresholds to defaults", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, gateThresholds: { v2Repeat: 5 } },
    });
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, gateThresholds: {} },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ budget: 300, gateThresholds: {} });
  });

  it("PUT rejects invalid gateThresholds with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, gateThresholds: { v2Repeat: -1 } },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toContain("gateThresholds");
  });

  it("PUT rejects gateThresholds with unknown fields (typo protection)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, gateThresholds: { v2reapeat: 5 } },
    });
    expect(put.statusCode).toBe(400);
  });

  it("PUT persists and echoes valid scorecard thresholds alongside budget", async () => {
    const payload = {
      budget: 300,
      scorecardThresholds: { floorCalls: 15, A: 96, B: 86, C: 71, D: 51 },
    };
    const put = await app.inject({ method: "PUT", url: "/api/config", payload });

    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual(payload);
    expect((await app.inject({ method: "GET", url: "/api/config" })).json()).toEqual(payload);
  });

  it("PUT rejects malformed scorecard thresholds with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, scorecardThresholds: { A: 80, B: 90 } },
    });

    expect(put.statusCode).toBe(400);
    expect(put.json().error).toContain("scorecardThresholds");
  });

  it("PUT accepts pricing/scanRoots/anomalyFactor alongside budget and persists them (#P4-15)", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: {
        budget: 300,
        pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
        scanRoots: [{ path: "/x", label: "mac-mini-home" }],
        anomalyFactor: 3,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({
      budget: 300,
      pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
      scanRoots: [{ path: "/x", label: "mac-mini-home" }],
      anomalyFactor: 3,
    });

    const get = await app.inject({ method: "GET", url: "/api/config" });
    expect(get.json()).toEqual({
      budget: 300,
      pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
      scanRoots: [{ path: "/x", label: "mac-mini-home" }],
      anomalyFactor: 3,
    });
  });

  it("PUT rejects invalid pricing with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, pricing: { "claude-sonnet-5": { input: -1 } } },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toContain("pricing");
  });

  it("PUT rejects invalid scanRoots with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, scanRoots: [{ path: "" }] },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toContain("scanRoots");
  });

  it("PUT rejects invalid anomalyFactor with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, anomalyFactor: -1 },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json().error).toContain("anomalyFactor");
  });

  it("PUT with scanRoots propagates live into the Store's host resolution (#P4-15)", async () => {
    store.applyRecords(
      "s1",
      {
        calls: [
          {
            uuid: "u1",
            sessionId: "s1",
            messageId: "m1",
            timestamp: "2026-01-01T00:00:00.000Z",
            model: "claude-sonnet-5",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheCreateTokens: 0,
            },
            isSidechain: false,
            tools: [],
            cwd: "/proj",
            gitBranch: "main",
            version: "1.0.0",
            entrypoint: "cli",
          },
        ],
        prompts: [],
        toolResultBytes: [],
        compactions: [],
        rawLines: 0,
        skippedLines: 0,
        duplicateCount: 0,
        malformedCount: 0,
      },
      "/roots/a",
    );
    store.flushAll();
    expect(store.getSession("s1")?.host).toBe("/roots/a");

    const put = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300, scanRoots: [{ path: "/roots/a", label: "mac-mini-home" }] },
    });
    expect(put.statusCode).toBe(200);
    store.flushAll();
    expect(store.getSession("s1")?.host).toBe("mac-mini-home");
  });

  it("PUT with scanRoots emits a scan-updated invalidation (review #19)", async () => {
    const captured: import("../../shared/ws-protocol.js").WsServerMessage[] = [];
    const storeWithCapture = new Store({ onInvalidate: (m) => captured.push(m) });
    try {
      const appWithCapture = buildApp({ store: storeWithCapture, logger: false, configPath });
      try {
        const put = await appWithCapture.inject({
          method: "PUT",
          url: "/api/config",
          payload: { budget: 300, scanRoots: [{ path: "/roots/a", label: "mac-mini" }] },
        });
        expect(put.statusCode).toBe(200);
        // updateHostLabels emits scan-updated immediately (no debounce —
        // matches the existing markScanDirty broadcast semantics). Without
        // this, already-mounted Sessions/Dashboard pages silently keep
        // showing the old host label.
        expect(captured.some((m) => m.type === "scan-updated")).toBe(true);
      } finally {
        await appWithCapture.close();
      }
    } finally {
      storeWithCapture.stop();
    }
  });

  it("an independent PUT with only `pricing` preserves a `budget` set in a prior PUT (review #19, ARCH Risk table)", async () => {
    // ARCH-settings-local-store.md's Risk table explicitly calls this
    // regression out: a Settings PUT that changes `pricing` must not
    // clobber a `budget` set moments earlier by BudgetForecastPanel —
    // writeConfig's merge-not-replace semantics is the mechanism, this
    // test pins the contract across two requests rather than the same
    // payload.
    const first = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 300 },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: {
        budget: 300,
        pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
      },
    });
    expect(second.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/api/config" });
    expect(get.json()).toEqual({
      budget: 300,
      pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
    });

    // Same scenario in reverse order — pricing set first, then budget
    // edited alone. The same merge-not-replace guarantee applies.
    await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: {
        budget: 300,
        pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
      },
    });
    const third = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { budget: 450 },
    });
    expect(third.statusCode).toBe(200);

    const getAfter = await app.inject({ method: "GET", url: "/api/config" });
    expect(getAfter.json()).toMatchObject({
      budget: 450,
      pricing: { "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 } },
    });
  });
});
