import { afterEach, describe, expect, it, vi } from "vitest";
import type { VersionSnapshot } from "../../../shared/version-contract.js";
import { fetchVersion, VersionApiError } from "./version.js";

const snapshot: VersionSnapshot = {
  currentVersion: "1.2.0",
  latestVersion: "1.3.0",
  updateAvailable: true,
  lastCheckedAt: 12345,
};

describe("fetchVersion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/version and returns the parsed snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })),
    );
    const result = await fetchVersion();
    expect(result).toEqual(snapshot);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/version",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws a VersionApiError on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })),
    );
    await expect(fetchVersion()).rejects.toThrow(VersionApiError);
    await expect(fetchVersion()).rejects.toThrow(/404/);
  });
});
