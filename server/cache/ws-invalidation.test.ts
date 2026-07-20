/**
 * WS-invalidation integration test (#P4-12 review finding #19): primes a
 * gates cache against a stub store, fires a `session-updated` message
 * through the broadcaster → in-process subscriber chain that
 * `app.ts:141-145` wires up, and asserts the cached entry is evicted
 * (so the next getSummary is a cold miss and the engine runs again).
 *
 * This is the load-bearing claim of the PR title: the broadcaster
 * delivers invalidations synchronously to in-process subscribers, and
 * `gatesCache.invalidate` is one such subscriber. Without this wiring
 * the server-side cache holds stale gate scores for the full
 * `staleTime` window after a transcript append.
 */

import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot, Store } from "../store/store.js";
import { createGatesCache } from "./gates-cache.js";
import { createBroadcaster } from "../ws/broadcaster.js";
import type { WsServerMessage } from "../../shared/ws-protocol.js";

function fakeSnapshot(sessionId: string): SessionSnapshot {
  return {
    session: {
      sessionId,
      lineageId: sessionId,
      project: "/tmp/proj",
      entrypoint: "",
      models: [],
      gitBranch: "",
      version: "",
      tier: {
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
        costBasis: "computed",
      },
      firstAt: "2026-07-01T00:00:00.000Z",
      lastAt: "2026-07-01T00:00:00.000Z",
      host: "default",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
      turnCount: 0,
      callCount: 0,
      costComputed: 0,
      cacheHitPct: 0,
    },
    calls: [],
    turns: [],
    prompts: [],
    toolResults: [],
    compactions: [],
  };
}

function fakeStore(snapshots: Record<string, SessionSnapshot | null>): Store {
  return {
    getSessionSnapshot: vi.fn((id: string) => snapshots[id] ?? null),
  } as unknown as Store;
}

describe("WS broadcaster → gates cache invalidation", () => {
  it("evicts a cached entry on session-updated so the next getSummary is a cold miss", async () => {
    // Use a single shared store + cache for the whole test. The
    // `vi.mocked(store.getSessionSnapshot)` is the same fn object across
    // the cache's lifetime; reading `mock.calls.length` against it
    // counts every call the cache made.
    const store = fakeStore({ s1: fakeSnapshot("s1") });
    const cache = createGatesCache({
      store,
      resolveThresholds: async () => ({
        v2Repeat: 3,
        c3MaxChars: 15_000,
        k2Spike: 10_000,
        e2MaxChars: 4_000,
        e2MaxLines: 60,
      }),
    });
    const broadcaster = createBroadcaster();

    // The same wire-up `app.ts:141-145` runs at startup: subscribe the
    // cache's invalidator to the broadcaster so every broadcast fires
    // `cache.invalidate(sessionId)`.
    const unsubscribe = broadcaster.subscribe((message: WsServerMessage) => {
      if (message.type === "session-updated" || message.type === "session-added") {
        cache.invalidate(message.sessionId);
      }
    });

    const getSnapshot = vi.mocked(store.getSessionSnapshot);
    const callsBeforePrime = getSnapshot.mock.calls.length;

    // Prime the cache: the FIRST getSummary triggers `evaluate`, which
    // reads the snapshot. The second getSummary is a warm hit and
    // does NOT call `getSessionSnapshot` again.
    await cache.getSummary("s1");
    await cache.getSummary("s1");
    expect(getSnapshot.mock.calls.length - callsBeforePrime).toBe(1);

    // Now fire a `session-updated` for the same id through the
    // broadcaster. The subscriber calls `cache.invalidate("s1")`; the
    // next getSummary is a cold miss and reads the snapshot again.
    broadcaster.broadcast({ type: "session-updated", sessionId: "s1" });
    const callsAfterInvalidate = getSnapshot.mock.calls.length;
    await cache.getSummary("s1");
    expect(getSnapshot.mock.calls.length - callsAfterInvalidate).toBe(1);

    unsubscribe();
  });

  it("does not evict on unrelated session-updated messages", async () => {
    const store = fakeStore({ s1: fakeSnapshot("s1"), s2: fakeSnapshot("s2") });
    const cache = createGatesCache({
      store,
      resolveThresholds: async () => ({
        v2Repeat: 3,
        c3MaxChars: 15_000,
        k2Spike: 10_000,
        e2MaxChars: 4_000,
        e2MaxLines: 60,
      }),
    });
    const broadcaster = createBroadcaster();
    broadcaster.subscribe((message: WsServerMessage) => {
      if (message.type === "session-updated" || message.type === "session-added") {
        cache.invalidate(message.sessionId);
      }
    });

    const getSnapshot = vi.mocked(store.getSessionSnapshot);
    // Prime s1 — single snapshot read.
    await cache.getSummary("s1");
    const before = getSnapshot.mock.calls.length;

    // Update s2 — s1's cache entry must remain intact.
    broadcaster.broadcast({ type: "session-updated", sessionId: "s2" });
    await cache.getSummary("s1");
    // No new snapshot call — s1 was a warm hit, s2's invalidation
    // didn't touch it.
    expect(getSnapshot.mock.calls.length).toBe(before);
  });
});
