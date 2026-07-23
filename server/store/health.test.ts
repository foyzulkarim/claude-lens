import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

// Review E1 — Data Health surfacing of parse-premium.ts's `malformedCount`.
// The Store accumulates per-file cumulative malformed counts and exposes
// them via `getHealthSnapshot()`. These tests pin the accumulator's
// behavior on the apply* methods (the only entry points).

function makeStore(): Store {
  return new Store({
    onInvalidate: () => {
      /* no-op for tests */
    },
  });
}

describe("Store.getHealthSnapshot (review E1 — Data Health surfacing of malformedCount)", () => {
  it("returns an empty snapshot before any premium file has been observed", () => {
    const store = makeStore();
    const snapshot = store.getHealthSnapshot();
    expect(snapshot.files).toEqual([]);
    expect(snapshot.totalMalformedLines).toBe(0);
    expect(snapshot.observedFileCount).toBe(0);
    expect(snapshot.observedSince).toBeGreaterThan(0);
    expect(snapshot.observedSince).toBeLessThanOrEqual(Date.now());
  });

  it("records a C file's malformed count when applyCostSamples is called with options", () => {
    const store = makeStore();
    store.applyCostSamples("session-a", [], {
      malformedCount: 3,
      filePath: "/home/user/.claude/projects/-Users-demo/abc.cost.jsonl",
    });
    const snapshot = store.getHealthSnapshot();
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0]).toMatchObject({
      filePath: "/home/user/.claude/projects/-Users-demo/abc.cost.jsonl",
      fileClass: "cost",
      sessionId: "session-a",
      malformedCount: 3,
    });
    expect(snapshot.totalMalformedLines).toBe(3);
    expect(snapshot.observedFileCount).toBe(1);
  });

  it("records a B file's malformed count when applyTurnBoundaries is called with options", () => {
    const store = makeStore();
    store.applyTurnBoundaries("session-b", [], {
      malformedCount: 1,
      filePath: "/home/user/.claude/projects/-Users-demo/abc.turn-boundaries.jsonl",
    });
    const snapshot = store.getHealthSnapshot();
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0]?.fileClass).toBe("turn-boundaries");
    expect(snapshot.files[0]?.malformedCount).toBe(1);
  });

  it("cumulatively aggregates malformed counts across multiple calls to the same file", () => {
    const store = makeStore();
    const filePath = "/home/user/.claude/projects/-Users-demo/abc.cost.jsonl";
    // Pipeline re-reads whole files on every change; a single malformed
    // line is counted again per re-read. Cumulative is the honest operator
    // signal (review E1 — comment in store.ts recordPremiumFileHealth).
    store.applyCostSamples("session-a", [], { malformedCount: 1, filePath });
    store.applyCostSamples("session-a", [], { malformedCount: 2, filePath });
    store.applyCostSamples("session-a", [], { malformedCount: 4, filePath });
    const snapshot = store.getHealthSnapshot();
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0]?.malformedCount).toBe(7);
    expect(snapshot.totalMalformedLines).toBe(7);
  });

  it("tracks the L file globally (no per-sessionId field)", () => {
    const store = makeStore();
    store.applyCostLog(
      [
        {
          sessionId: "session-x",
          timestamp: "2026-07-21T10:00:00.000Z",
          costUsd: 1.23,
          durationMs: 0,
          model: "claude-sonnet-4",
          dir: "/Users/demo",
          contextPct: 30,
          cacheRead: 0,
          cacheWrite: 0,
          linesAdded: 5,
          linesRemoved: 2,
        },
      ],
      { malformedCount: 2, filePath: "/home/user/.claude/cost-log.jsonl" },
    );
    const snapshot = store.getHealthSnapshot();
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0]).toMatchObject({
      fileClass: "cost-log",
      filePath: "/home/user/.claude/cost-log.jsonl",
      malformedCount: 2,
    });
    expect(snapshot.files[0]?.sessionId).toBeUndefined();
  });

  it("keys per-file entries by fileClass+colon+filePath so a global L file does not collide with a per-session C file at the same path", () => {
    const store = makeStore();
    const samePath = "/home/user/.claude/projects/-Users-demo/shared.jsonl";
    store.applyCostSamples("session-a", [], { malformedCount: 1, filePath: samePath });
    // Hypothetical collision case: the same path used for two file classes.
    // The key includes `fileClass` so each gets its own entry. (Today the
    // pipeline wouldn't actually produce this — different file extensions
    // produce different paths — but the key discipline still matters for
    // future ops / overrides.)
    store.applyCostLog(
      [
        {
          sessionId: "session-a",
          timestamp: "2026-07-21T10:00:00.000Z",
          costUsd: 0,
          durationMs: 0,
          model: "claude-sonnet-4",
          dir: "/Users/demo",
          contextPct: 0,
          cacheRead: 0,
          cacheWrite: 0,
          linesAdded: 0,
          linesRemoved: 0,
        },
      ],
      { malformedCount: 5, filePath: samePath },
    );
    const snapshot = store.getHealthSnapshot();
    expect(snapshot.files).toHaveLength(2);
    const counts = snapshot.files.map((f) => f.malformedCount).sort();
    expect(counts).toEqual([1, 5]);
  });

  it("does not record a health entry when malformedCount is omitted (back-compat for callers without E1 wiring)", () => {
    const store = makeStore();
    store.applyCostSamples("session-a", []);
    expect(store.getHealthSnapshot().files).toHaveLength(0);
  });

  it("does not record a health entry when filePath is omitted even with malformedCount", () => {
    const store = makeStore();
    // Edge case: a caller forgets to thread filePath. We silently drop
    // the count rather than fabricate a key — the per-file health entry
    // is meaningful only with a stable file identity.
    store.applyCostSamples("session-a", [], { malformedCount: 5 });
    expect(store.getHealthSnapshot().files).toHaveLength(0);
  });

  it("returns a defensive copy of the per-file entries (mutating the snapshot does not affect future reads)", () => {
    const store = makeStore();
    store.applyCostSamples("session-a", [], {
      malformedCount: 1,
      filePath: "/home/user/.claude/projects/-Users-demo/abc.cost.jsonl",
    });
    const first = store.getHealthSnapshot();
    const firstFile = first.files[0];
    if (!firstFile) throw new Error("expected a health file entry");
    firstFile.malformedCount = 999;
    first.totalMalformedLines = 999;
    const second = store.getHealthSnapshot();
    expect(second.files[0]?.malformedCount).toBe(1);
    expect(second.totalMalformedLines).toBe(1);
  });
});
