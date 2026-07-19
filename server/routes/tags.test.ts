import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLocalStore } from "../local-store.js";
import { registerTagsRoute } from "./tags.js";

describe("GET /api/tags, PUT/DELETE /api/tags/:tag", () => {
  let app: FastifyInstance;
  let dir: string;
  let localStorePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-lens-tags-"));
    localStorePath = join(dir, "local.json");
    await writeLocalStore(
      { tags: { s1: ["important", "follow-up"], s2: ["important"] } },
      localStorePath,
    );
    app = Fastify({ logger: false });
    registerTagsRoute(app, { localStorePath });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("GET lists distinct tags with usage counts, sorted", async () => {
    const response = await app.inject({ method: "GET", url: "/api/tags" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      { tag: "follow-up", sessionCount: 1 },
      { tag: "important", sessionCount: 2 },
    ]);
  });

  it("PUT renames a tag across every session", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/tags/important",
      payload: { newName: "priority" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ tag: "priority" });

    const get = await app.inject({ method: "GET", url: "/api/tags" });
    expect(get.json()).toEqual([
      { tag: "follow-up", sessionCount: 1 },
      { tag: "priority", sessionCount: 2 },
    ]);
  });

  it("PUT renaming into an existing tag name dedupes per-session (review #19)", async () => {
    // s1 has ["important","follow-up"]. Renaming `important` → `follow-up`
    // would have produced ["follow-up","follow-up"] pre-fix, inflating the
    // sessionCount and rendering as two duplicate chips. The dedupe on the
    // rebuild path keeps it as a single, honest entry.
    const put = await app.inject({
      method: "PUT",
      url: "/api/tags/important",
      payload: { newName: "follow-up" },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: "/api/tags" });
    // s1's two `follow-up`s collapse to one. s2's lone `important` is
    // renamed to `follow-up`. So the surviving tag is `follow-up` with
    // sessionCount 2.
    expect(get.json()).toEqual([{ tag: "follow-up", sessionCount: 2 }]);

    // Read the raw on-disk store directly so a future regression that
    // re-introduced duplicates on the wire but kept the dedupe in the
    // GET count helper would still fail this test.
    const { readLocalStore } = await import("../local-store.js");
    const onDisk = await readLocalStore(localStorePath);
    expect(onDisk.tags.s1).toEqual(["follow-up"]);
    expect(onDisk.tags.s2).toEqual(["follow-up"]);
  });

  it("PUT rejects an empty newName with 400", async () => {
    const put = await app.inject({
      method: "PUT",
      url: "/api/tags/important",
      payload: { newName: "" },
    });
    expect(put.statusCode).toBe(400);
  });

  it("DELETE removes a tag from every session", async () => {
    const del = await app.inject({ method: "DELETE", url: "/api/tags/important" });
    expect(del.statusCode).toBe(204);

    const get = await app.inject({ method: "GET", url: "/api/tags" });
    expect(get.json()).toEqual([{ tag: "follow-up", sessionCount: 1 }]);
  });
});
