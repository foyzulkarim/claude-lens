import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigApiError, getConfig, putConfig } from "./config.js";

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

describe("getConfig", () => {
  it("GETs /api/config and returns the parsed body", async () => {
    installFetch(async () => makeResponse({ budget: 300 }));
    await expect(getConfig()).resolves.toEqual({ budget: 300 });
  });

  it("forwards the AbortSignal", async () => {
    let capturedSignal: AbortSignal | undefined;
    installFetch(async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return makeResponse({ budget: null });
    });
    const controller = new AbortController();
    await getConfig(controller.signal);
    expect(capturedSignal).toBe(controller.signal);
  });

  it("throws ConfigApiError with the server's message on non-2xx", async () => {
    installFetch(async () => makeResponse({ error: "boom" }, { status: 500 }));
    await expect(getConfig()).rejects.toMatchObject({
      name: "ConfigApiError",
      status: 500,
      validation: "boom",
    });
  });
});

describe("putConfig", () => {
  it("PUTs the patch as JSON with the right method + content type", async () => {
    let captured:
      | { url: string; method: string; headers: Record<string, string>; body: string }
      | undefined;
    installFetch(async (url, init) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(init?.headers ?? {})) {
        headers[k] = String(v);
      }
      captured = {
        url,
        method: init?.method ?? "",
        headers,
        body: typeof init?.body === "string" ? init.body : "",
      };
      return makeResponse({ budget: 300 });
    });

    await putConfig({ budget: 300 });

    expect(captured?.url).toBe("/api/config");
    expect(captured?.method).toBe("PUT");
    expect(captured?.headers["Content-Type"] ?? captured?.headers["content-type"]).toBe(
      "application/json",
    );
    expect(JSON.parse(captured?.body ?? "{}")).toEqual({ budget: 300 });
  });

  it("surfaces a validation error via ConfigApiError on 400", async () => {
    installFetch(async () =>
      makeResponse(
        { error: "budget must be null or a finite number greater than 0" },
        { status: 400 },
      ),
    );
    await expect(putConfig({ budget: -1 })).rejects.toBeInstanceOf(ConfigApiError);
  });
});
