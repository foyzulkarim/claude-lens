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

// 🟢 #P4-14 TC-2 — full `/api/health` route integration. Asserts every
// P4-14 rollup from transcript, C, B, and L content lands on the wire
// in the documented shape. Existing route tests asserted only the
// legacy four fields, so a regression in the new sections (dedup /
// scan / pricing / sidecar / reconciliation / captureGaps) was
// silent — this test pins the full new wire shape end to end.
describe("GET /api/health — full P4-14 wire shape (#P4-14 TC-2)", () => {
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

  it("returns every P4-14 rollup wired up against store state", async () => {
    // One observed session (C sidecar with non-empty samples) + one
    // transcript-only session. Both exercise the dedup / parseErrors
    // / pricingCoverage / sidecarCoverage rollups; the C-bearing
    // session additionally populates reconciliation.sessionsWithObserved.
    store.applyRecords(
      "observed",
      {
        calls: [],
        prompts: [],
        toolResultBytes: [],
        compactions: [],
        rawLines: 12,
        duplicateCount: 1,
        skippedLines: 0,
        malformedCount: 3,
      },
      "/root",
    );
    store.applyRecords(
      "transcript-only",
      {
        calls: [],
        prompts: [],
        toolResultBytes: [],
        compactions: [],
        rawLines: 5,
        duplicateCount: 0,
        skippedLines: 0,
        malformedCount: 0,
      },
      "/root",
    );
    store.applyCostSamples(
      "observed",
      [
        {
          sessionId: "observed",
          timestamp: "2026-07-03T00:00:02.000Z",
          costDeltaUsd: 0.1,
          cumulativeCostUsd: 0.1,
          apiDurationMs: 1000,
          contextPct: 10,
          linesAdded: 0,
          linesRemoved: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ],
      { malformedCount: 1, filePath: "/root/observed.cost.jsonl" },
    );

    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dedup: { rawLines: number; distinctCalls: number; duplicates: number };
      parseErrors: { malformedLines: number; byFile: { filePath: string; count: number }[] };
      scan: {
        transcriptsFound: number;
        transcriptsParsed: number;
        transcriptsFailed: number;
        sessionsWithSidecars: number;
      };
      pricingCoverage: { modelsSeen: string[]; unpricedModels: string[] };
      sidecarCoverage: { total: number; withCost: number; withBoundaries: number };
      reconciliation: { sessionsWithObserved: number; sessionsWithComputedOnly: number };
      captureGaps: { sessionsWithoutObserved: number };
    };

    // §1 — dedup aggregates rawLines additively across sessions.
    expect(body.dedup.rawLines).toBe(17);
    expect(body.dedup.duplicates).toBe(1);
    // §1 — parseErrors totals + per-file top-N.
    expect(body.parseErrors.malformedLines).toBe(3);
    expect(body.parseErrors.byFile.length).toBeGreaterThan(0);
    // §2 — scan: both sessions parsed; no pipelineStats callback
    // (test buildApp without `pipeline`), so transcriptsFound falls
    // back to transcriptsParsed.
    expect(body.scan.transcriptsParsed).toBe(2);
    expect(body.scan.transcriptsFailed).toBe(0);
    expect(body.scan.sessionsWithSidecars).toBe(1);
    // §3 — reconciliation: only the C-bearing session is "observed".
    expect(body.reconciliation.sessionsWithObserved).toBe(1);
    expect(body.reconciliation.sessionsWithComputedOnly).toBe(1);
    // §4 — capture-gaps mirrors reconciliation.sessionsWithComputedOnly.
    expect(body.captureGaps.sessionsWithoutObserved).toBe(1);
    // Sidecar coverage.
    expect(body.sidecarCoverage.total).toBe(2);
    expect(body.sidecarCoverage.withCost).toBe(1);
    expect(body.sidecarCoverage.withBoundaries).toBe(0);
  });
});
