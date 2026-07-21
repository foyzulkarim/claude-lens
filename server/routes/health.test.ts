import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { Store } from "../store/store.js";

// Route-level test for GET /api/health (review E1 — Data Health surfacing
// of `parse-premium.ts`'s `malformedCount`). The route is a thin
// pass-through to `Store.getHealthSnapshot()`; the test pins that the
// contract the DataHealth page consumes is what comes back.

describe("GET /api/health (review E1)", () => {
  let store: Store;
  let app: ReturnType<typeof buildApp>;
  let baseUrl: string;

  beforeEach(async () => {
    store = new Store({
      onInvalidate: () => {
        /* no-op */
      },
    });
    app = buildApp({
      store,
      logger: false,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server to be listening on a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
    store.stop();
  });

  it("returns the empty-snapshot shape when no premium files have been observed", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: unknown[];
      totalMalformedLines: number;
      observedFileCount: number;
      observedSince: number;
    };
    expect(body.files).toEqual([]);
    expect(body.totalMalformedLines).toBe(0);
    expect(body.observedFileCount).toBe(0);
    expect(body.observedSince).toBeGreaterThan(0);
  });

  it("surfaces a recorded malformed count", async () => {
    store.applyCostSamples("session-a", [], {
      malformedCount: 7,
      filePath: "/home/user/.claude/projects/-Users-demo/abc.cost.jsonl",
    });
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: Array<{
        filePath: string;
        fileClass: string;
        sessionId?: string;
        malformedCount: number;
      }>;
      totalMalformedLines: number;
      observedFileCount: number;
    };
    expect(body.totalMalformedLines).toBe(7);
    expect(body.observedFileCount).toBe(1);
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({
      filePath: "/home/user/.claude/projects/-Users-demo/abc.cost.jsonl",
      fileClass: "cost",
      sessionId: "session-a",
      malformedCount: 7,
    });
  });
});
