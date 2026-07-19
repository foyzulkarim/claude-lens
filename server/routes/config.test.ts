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
});
