import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { Store } from "../store/store.js";

// Route-level test for GET /api/capture-assets
// (ARCH-producer-cost-capture-tier §API Contracts, decision A5). The route
// is a thin pass-through to the resolved `captureDir`; both the
// resolved-path and unresolved (`null`, S7) cases must return 200, never a
// 500 — a broken path is a documented `null`, not a thrown error.

describe("GET /api/capture-assets", () => {
  let store: Store;
  let app: ReturnType<typeof buildApp>;
  let baseUrl: string;

  async function start(captureDir: string | null): Promise<void> {
    store = new Store({
      onInvalidate: () => {
        /* no-op */
      },
    });
    app = buildApp({ store, logger: false, captureDir });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server to be listening on a TCP port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  afterEach(async () => {
    await app.close();
    store.stop();
  });

  it("returns the resolved capture directory", async () => {
    await start("/home/user/.claude-lens-checkout/capture");
    const res = await fetch(`${baseUrl}/api/capture-assets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { captureDir: string | null };
    expect(body.captureDir).toBe("/home/user/.claude-lens-checkout/capture");
  });

  it("returns null (not a 500) when the capture directory can't be resolved (S7)", async () => {
    await start(null);
    const res = await fetch(`${baseUrl}/api/capture-assets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { captureDir: string | null };
    expect(body.captureDir).toBeNull();
  });
});

describe("GET /api/capture-assets — default wiring", () => {
  let store: Store;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    store = new Store({
      onInvalidate: () => {
        /* no-op */
      },
    });
  });

  afterEach(async () => {
    await app.close();
    store.stop();
  });

  it("falls back to the real resolveCaptureDir() when no override is passed, and never throws", async () => {
    app = buildApp({ store, logger: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected server to be listening on a TCP port");
    }
    const res = await fetch(`http://127.0.0.1:${address.port}/api/capture-assets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { captureDir: string | null };
    // Running from a source checkout with no dist/ build, the dev candidate
    // (../capture relative to server/capture-assets.ts) resolves.
    expect(typeof body.captureDir === "string" || body.captureDir === null).toBe(true);
  });
});
