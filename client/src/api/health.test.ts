import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthSnapshot } from "../../../shared/health-contract.js";
import { fetchHealth } from "./health.js";

const snapshot: HealthSnapshot = {
  files: [],
  totalMalformedLines: 0,
  observedFileCount: 0,
  observedSince: 0,
  dedup: { rawLines: 0, distinctCalls: 0, duplicates: 0 },
  parseErrors: { malformedLines: 0, byFile: [] },
  scan: {
    roots: [],
    transcriptsFound: 0,
    transcriptsParsed: 0,
    transcriptsFailed: 0,
    sessionsWithSidecars: 0,
  },
  pricingCoverage: { modelsSeen: [], unpricedModels: [] },
  sidecarCoverage: { total: 0, withCost: 0, withBoundaries: 0 },
  reconciliation: {
    sessionsWithObserved: 0,
    sessionsWithComputedOnly: 0,
    costComputed: 0,
    costObserved: 0,
  },
  captureGaps: { sessionsWithoutObserved: 0 },
};

describe("fetchHealth", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(snapshot), { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/health and returns the parsed snapshot", async () => {
    const result = await fetchHealth();
    expect(result).toEqual(snapshot);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws on non-2xx with the server's error message when present", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })),
    );
    await expect(fetchHealth()).rejects.toThrow(/boom/);
  });

  it("throws with statusText when the error body is malformed", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("not-json", { status: 503, statusText: "Service Unavailable" }),
      ),
    );
    await expect(fetchHealth()).rejects.toThrow(/Service Unavailable/);
  });
});
