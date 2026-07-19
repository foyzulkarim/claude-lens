import { afterEach, describe, expect, it, vi } from "vitest";
import { getSearchIndex, SearchIndexApiError, SearchIndexResponseShapeError } from "./search.js";

const VALID_DOC = {
  id: "s1:p1",
  sessionId: "s1",
  promptId: "p1",
  turnNumber: 1,
  text: "hello world",
  timestamp: "2026-07-20T10:00:00.000Z",
};

const VALID_BODY = { prompts: [VALID_DOC], version: 1 };

function makeResponse(body: unknown, init: { status?: number; ok?: boolean } = {}): Response {
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

describe("getSearchIndex — request shape (#P4-3)", () => {
  it("GETs /api/search-index without a body or special headers", async () => {
    let captured: { url: string; method: string; body: string | undefined } | undefined;
    installFetch(async (url, init) => {
      captured = {
        url,
        method: init?.method ?? "",
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      return makeResponse(VALID_BODY);
    });

    await getSearchIndex();

    expect(captured?.url).toBe("/api/search-index");
    // fetch() defaults to GET when method is omitted; assert that's what we sent.
    expect(captured?.method).toBe("");
    expect(captured?.body).toBeUndefined();
  });

  it("forwards the AbortSignal to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    installFetch(async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return makeResponse(VALID_BODY);
    });
    const controller = new AbortController();
    await getSearchIndex(controller.signal);
    expect(capturedSignal).toBe(controller.signal);
  });

  it("returns the parsed response on 2xx", async () => {
    installFetch(async () => makeResponse(VALID_BODY));
    const result = await getSearchIndex();
    expect(result).toEqual(VALID_BODY);
  });
});

describe("getSearchIndex — error handling (#P4-3)", () => {
  it("surfaces the server's error message on non-2xx via SearchIndexApiError", async () => {
    installFetch(async () => makeResponse({ error: "internal server error" }, { status: 500 }));
    await expect(getSearchIndex()).rejects.toMatchObject({
      name: "SearchIndexApiError",
      status: 500,
      validation: "internal server error",
    });
  });

  it("rejects malformed JSON as SearchIndexApiError, not a runtime crash", async () => {
    installFetch(
      async () =>
        new Response("not-json", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );
    await expect(getSearchIndex()).rejects.toBeInstanceOf(SearchIndexApiError);
  });

  it("rejects a 2xx response missing `prompts` as SearchIndexResponseShapeError", async () => {
    installFetch(async () => makeResponse({ version: 1 }));
    await expect(getSearchIndex()).rejects.toBeInstanceOf(SearchIndexResponseShapeError);
  });

  it("rejects a 2xx response missing `version` as SearchIndexResponseShapeError", async () => {
    installFetch(async () => makeResponse({ prompts: [] }));
    await expect(getSearchIndex()).rejects.toBeInstanceOf(SearchIndexResponseShapeError);
  });

  it("rejects a 2xx response with a malformed first doc as SearchIndexResponseShapeError", async () => {
    installFetch(async () =>
      makeResponse({
        prompts: [{ id: "s1:p1" }], // missing sessionId/promptId/turnNumber/text/timestamp
        version: 1,
      }),
    );
    await expect(getSearchIndex()).rejects.toBeInstanceOf(SearchIndexResponseShapeError);
  });

  it("accepts a 2xx response with an empty `prompts` array (honest no-data state)", async () => {
    installFetch(async () => makeResponse({ prompts: [], version: 1 }));
    const result = await getSearchIndex();
    expect(result.prompts).toEqual([]);
  });
});
