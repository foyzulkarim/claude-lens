import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { Store } from "../store/store.js";
import * as versionCheck from "../version-check.js";

// Route-level test for GET /api/version. The route is a thin pass-through
// to the checker's cached snapshot (server/routes/version.ts); this pins
// both the "checker never started" fallback shape (the default in every
// test, matching `enableEventLoopMonitor`'s off-by-default convention) and
// that the route surfaces whatever the checker reports.

describe("GET /api/version", () => {
  let store: Store;
  let app: ReturnType<typeof buildApp>;
  let baseUrl: string;

  async function start(enableVersionCheck: boolean): Promise<void> {
    store = new Store({
      onInvalidate: () => {
        /* no-op */
      },
    });
    app = buildApp({ store, logger: false, enableVersionCheck });
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
    vi.restoreAllMocks();
  });

  it("returns the 'no update known' fallback when the checker never started", async () => {
    await start(false);
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(body).toEqual({
      currentVersion: versionCheck.CURRENT_VERSION,
      latestVersion: null,
      updateAvailable: false,
      lastCheckedAt: null,
    });
  });

  it("surfaces the checker's snapshot once it has started", async () => {
    const fakeSnapshot = {
      currentVersion: versionCheck.CURRENT_VERSION,
      latestVersion: "99.0.0",
      updateAvailable: true,
      lastCheckedAt: 12345,
    };
    vi.spyOn(versionCheck, "startVersionChecker").mockReturnValue({
      stop: vi.fn(),
      getSnapshot: () => fakeSnapshot,
    });
    await start(true);
    await app.ready();
    const res = await fetch(`${baseUrl}/api/version`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeSnapshot);
  });
});
