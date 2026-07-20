import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerViewsRoute } from "./views.js";

describe("GET/POST /api/views, DELETE /api/views/:id", () => {
  let app: FastifyInstance;
  let dir: string;
  let localStorePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-lens-views-"));
    localStorePath = join(dir, "local.json");
    app = Fastify({ logger: false });
    registerViewsRoute(app, { localStorePath });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET returns an empty array when no views exist", async () => {
    const response = await app.inject({ method: "GET", url: "/api/views" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("POST creates a view with a server-generated id/createdAt", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/views",
      payload: { name: "My view", path: "/sessions", search: "?range=7d" },
    });
    expect(post.statusCode).toBe(200);
    const view = post.json();
    expect(view.name).toBe("My view");
    expect(view.path).toBe("/sessions");
    expect(view.search).toBe("?range=7d");
    expect(typeof view.id).toBe("string");
    expect(view.id.length).toBeGreaterThan(0);
    expect(typeof view.createdAt).toBe("string");

    const get = await app.inject({ method: "GET", url: "/api/views" });
    expect(get.json()).toEqual([view]);
  });

  it("POST rejects an invalid body with 400", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/views",
      payload: { name: "", path: "/x", search: "" },
    });
    expect(post.statusCode).toBe(400);
  });

  it("POST persists optional pinned:true (ARCH-explore-page.md A3)", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/views",
      payload: {
        name: "tokens by tool",
        path: "/explore",
        search: "?xp.measure=inputTokens",
        pinned: true,
      },
    });
    expect(post.statusCode).toBe(200);
    const view = post.json();
    expect(view.pinned).toBe(true);

    const get = await app.inject({ method: "GET", url: "/api/views" });
    expect(get.json()[0].pinned).toBe(true);
  });

  it("POST omits the pinned key when not provided (back-compat with old clients)", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/views",
      payload: { name: "x", path: "/sessions", search: "" },
    });
    const view = post.json();
    expect(view.pinned).toBeUndefined();
  });

  it("POST rejects a non-boolean pinned with 400", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/views",
      payload: { name: "x", path: "/explore", search: "", pinned: "yes" },
    });
    expect(post.statusCode).toBe(400);
  });

  it("DELETE removes a view by id", async () => {
    const post = await app.inject({
      method: "POST",
      url: "/api/views",
      payload: { name: "x", path: "/x", search: "" },
    });
    const id = post.json().id;

    const del = await app.inject({ method: "DELETE", url: `/api/views/${id}` });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: "/api/views" });
    expect(get.json()).toEqual([]);
  });

  it("DELETE 404s for an unknown id", async () => {
    const del = await app.inject({ method: "DELETE", url: "/api/views/unknown" });
    expect(del.statusCode).toBe(404);
  });
});
