import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createView,
  deleteTag,
  deleteView,
  getTags,
  getViews,
  renameTag,
  setSessionTags,
} from "./localStore.js";

function makeResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  responder: (url: string, init: RequestInit | undefined) => Promise<Response>,
): void {
  const fakeFetch = vi.fn(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return responder(url, init);
    },
  );
  vi.stubGlobal("fetch", fakeFetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getViews / createView / deleteView", () => {
  it("GETs /api/views and returns the parsed body", async () => {
    installFetch(async () =>
      makeResponse([{ id: "1", name: "x", path: "/", search: "", createdAt: "now" }]),
    );
    await expect(getViews()).resolves.toEqual([
      { id: "1", name: "x", path: "/", search: "", createdAt: "now" },
    ]);
  });

  it("POSTs the input as JSON and returns the created view", async () => {
    let captured: { url: string; method: string; body: string } | undefined;
    installFetch(async (url, init) => {
      captured = {
        url,
        method: init?.method ?? "",
        body: typeof init?.body === "string" ? init.body : "",
      };
      return makeResponse({
        id: "1",
        name: "x",
        path: "/sessions",
        search: "?a=1",
        createdAt: "now",
      });
    });
    await createView({ name: "x", path: "/sessions", search: "?a=1" });
    expect(captured?.url).toBe("/api/views");
    expect(captured?.method).toBe("POST");
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({
      name: "x",
      path: "/sessions",
      search: "?a=1",
    });
  });

  it("DELETEs by id", async () => {
    let captured: { url: string; method: string } | undefined;
    installFetch(async (url, init) => {
      captured = { url, method: init?.method ?? "" };
      return new Response(null, { status: 204 });
    });
    await deleteView("abc");
    expect(captured?.url).toBe("/api/views/abc");
    expect(captured?.method).toBe("DELETE");
  });

  it("throws LocalStoreApiError on non-2xx", async () => {
    installFetch(async () => makeResponse({ error: "boom" }, { status: 400 }));
    await expect(createView({ name: "", path: "/", search: "" })).rejects.toMatchObject({
      name: "LocalStoreApiError",
      status: 400,
      validation: "boom",
    });
  });
});

describe("getTags / renameTag / deleteTag", () => {
  it("GETs /api/tags", async () => {
    installFetch(async () => makeResponse([{ tag: "important", sessionCount: 2 }]));
    await expect(getTags()).resolves.toEqual([{ tag: "important", sessionCount: 2 }]);
  });

  it("PUTs a rename with the right body", async () => {
    let captured: { url: string; body: string } | undefined;
    installFetch(async (url, init) => {
      captured = { url, body: typeof init?.body === "string" ? init.body : "" };
      return makeResponse({ tag: "priority" });
    });
    await renameTag("important", "priority");
    expect(captured?.url).toBe("/api/tags/important");
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({ newName: "priority" });
  });

  it("DELETEs a tag", async () => {
    let captured: { url: string; method: string } | undefined;
    installFetch(async (url, init) => {
      captured = { url, method: init?.method ?? "" };
      return new Response(null, { status: 204 });
    });
    await deleteTag("important");
    expect(captured?.url).toBe("/api/tags/important");
    expect(captured?.method).toBe("DELETE");
  });
});

describe("setSessionTags", () => {
  it("PUTs the tag list and returns the server's echoed tags", async () => {
    let captured: { url: string; body: string } | undefined;
    installFetch(async (url, init) => {
      captured = { url, body: typeof init?.body === "string" ? init.body : "" };
      return makeResponse({ tags: ["a", "b"] });
    });
    await expect(setSessionTags("s1", ["a", "b"])).resolves.toEqual(["a", "b"]);
    expect(captured?.url).toBe("/api/sessions/s1/tags");
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({ tags: ["a", "b"] });
  });
});
