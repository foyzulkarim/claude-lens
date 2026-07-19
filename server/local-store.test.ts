import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLocalStore, writeLocalStore } from "./local-store.js";

describe("readLocalStore / writeLocalStore", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-lens-local-store-"));
    storePath = join(dir, "nested", "local.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the default when the file does not exist", async () => {
    expect(await readLocalStore(storePath)).toEqual({ views: [], tags: {} });
  });

  it("returns the default when the file is unparseable JSON", async () => {
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(storePath, "not json", "utf8");
    expect(await readLocalStore(storePath)).toEqual({ views: [], tags: {} });
  });

  it("returns the default when views/tags have the wrong shape", async () => {
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(storePath, JSON.stringify({ views: "nope", tags: {} }), "utf8");
    expect(await readLocalStore(storePath)).toEqual({ views: [], tags: {} });
  });

  it("drops invalid elements inside a partially-corrupt local.json (review #19)", async () => {
    // Container shape passes; one bad SavedView + one bad tag array entry.
    // The deep-validate filters them out instead of trusting the cast — a
    // non-array `tags[s1]` used to crash `server/routes/tags.ts`'s
    // `for (const tag of sessionTags)` loop with a confusing 500.
    await mkdir(join(dir, "nested"), { recursive: true });
    const partial = {
      views: [
        { id: "ok", name: "good", path: "/sessions", search: "", createdAt: "2026-07-19" },
        { id: "bad" }, // missing every other field
        "not even an object",
      ],
      tags: {
        s1: ["a", "b"],
        s2: "not-an-array", // would crash downstream loops pre-fix
        s3: ["valid", { not: "a string" }], // element-level corruption
      },
    };
    await writeFile(storePath, JSON.stringify(partial), "utf8");
    expect(await readLocalStore(storePath)).toEqual({
      views: [{ id: "ok", name: "good", path: "/sessions", search: "", createdAt: "2026-07-19" }],
      tags: { s1: ["a", "b"] },
    });
  });

  it("rejects user-supplied strings longer than the length cap (review #19)", async () => {
    // isValidSavedViewInput must reject a path longer than the cap so a
    // pathological PUT doesn't grow local.json unboundedly (the whole
    // file is rewritten per mutation).
    const tooLong = "x".repeat(201);
    await expect(
      import("../shared/local-store-contract.js").then(({ isValidSavedViewInput }) =>
        isValidSavedViewInput({ name: "x", path: "/sessions", search: tooLong }),
      ),
    ).resolves.toBe(false);
  });

  it("writeLocalStore creates the file (and parent dir) and persists the patch", async () => {
    const view = { id: "1", name: "x", path: "/sessions", search: "", createdAt: "now" };
    const result = await writeLocalStore({ views: [view] }, storePath);
    expect(result).toEqual({ views: [view], tags: {} });
    expect(await readLocalStore(storePath)).toEqual({ views: [view], tags: {} });
  });

  it("writeLocalStore merges onto existing content rather than replacing it", async () => {
    const view = { id: "1", name: "x", path: "/sessions", search: "", createdAt: "now" };
    await writeLocalStore({ views: [view] }, storePath);
    const result = await writeLocalStore({ tags: { s1: ["important"] } }, storePath);
    expect(result).toEqual({ views: [view], tags: { s1: ["important"] } });
  });
});
