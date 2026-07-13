import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import type { ApiCall } from "../../shared/types.js";
import type { ParseTranscriptResult } from "../ingest/parse-transcript.js";
import { Store } from "./store.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function call(overrides: Partial<ApiCall> = {}): ApiCall {
  return {
    uuid: `u-${Math.random()}`,
    sessionId: "s1",
    messageId: `m-${Math.random()}`,
    timestamp: "2026-07-13T00:00:00.000Z",
    model: "claude-sonnet-5",
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreateTokens: 0 },
    isSidechain: false,
    tools: [],
    cwd: "/repo",
    gitBranch: "main",
    version: "1.0.0",
    entrypoint: "cli",
    ...overrides,
  };
}

function batch(calls: ApiCall[]): ParseTranscriptResult {
  return { calls, prompts: [], toolResultBytes: [], duplicateCount: 0, malformedCount: 0 };
}

function makeStore(debounceMs = 300) {
  const invalidations: WsServerMessage[] = [];
  const store = new Store({ debounceMs, onInvalidate: (m) => invalidations.push(m) });
  return { store, invalidations };
}

describe("Store — session isolation", () => {
  it("appending calls to one session leaves other sessions' derived state untouched", () => {
    const { store } = makeStore();

    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    vi.advanceTimersByTime(300);
    store.applyRecords("s2", batch([call({ sessionId: "s2", messageId: "m2" })]));
    vi.advanceTimersByTime(300);

    const s1Before = store.getSession("s1");
    const s1TurnsBefore = store.getTurns("s1");
    expect(s1Before?.callCount).toBe(1);

    // Append more to s2 only.
    store.applyRecords("s2", batch([call({ sessionId: "s2", messageId: "m3" })]));
    vi.advanceTimersByTime(300);

    expect(store.getSession("s2")?.callCount).toBe(2);
    // s1's session object and derived turns are unchanged by s2's append.
    expect(store.getSession("s1")).toEqual(s1Before);
    expect(store.getTurns("s1")).toEqual(s1TurnsBefore);
    expect(store.getCalls("s1")).toHaveLength(1);
  });

  it("recompute(sessionId) only touches that session, even with many sessions live", () => {
    const { store } = makeStore();
    for (const id of ["a", "b", "c"]) {
      store.applyRecords(id, batch([call({ sessionId: id, messageId: `${id}-1` })]));
    }
    vi.advanceTimersByTime(300);

    const before = { a: store.getSession("a"), b: store.getSession("b"), c: store.getSession("c") };

    store.applyRecords("b", batch([call({ sessionId: "b", messageId: "b-2" })]));
    vi.advanceTimersByTime(300);

    expect(store.getSession("a")).toEqual(before.a);
    expect(store.getSession("c")).toEqual(before.c);
    expect(store.getSession("b")?.callCount).toBe(2);
  });
});

describe("Store — invalidation wiring", () => {
  it("emits session-added on first sighting and debounced session-updated after appends settle", () => {
    const { store, invalidations } = makeStore();

    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));
    expect(invalidations).toEqual([{ type: "session-added", sessionId: "s1" }]);

    vi.advanceTimersByTime(299);
    expect(invalidations).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(invalidations).toEqual([
      { type: "session-added", sessionId: "s1" },
      { type: "session-updated", sessionId: "s1" },
    ]);
  });

  it("coalesces a burst of appends to one session into a single session-updated", () => {
    const { store, invalidations } = makeStore();

    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    vi.advanceTimersByTime(100);
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m2" })]));
    vi.advanceTimersByTime(100);
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m3" })]));
    vi.advanceTimersByTime(300);

    const updates = invalidations.filter((m) => m.type === "session-updated");
    expect(updates).toHaveLength(1);
    expect(store.getSession("s1")?.callCount).toBe(3);
  });

  it("recomputes on flush so session data is fresh by the time session-updated fires", () => {
    const { store, invalidations } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));

    let sessionAtFlushTime: unknown;
    // Snapshot state precisely when the update fires, proving recompute() already ran.
    const originalPush = invalidations.push.bind(invalidations);
    invalidations.push = ((...items: WsServerMessage[]) => {
      if (items[0]?.type === "session-updated") {
        sessionAtFlushTime = store.getSession("s1");
      }
      return originalPush(...items);
    }) as typeof invalidations.push;

    vi.advanceTimersByTime(300);
    expect((sessionAtFlushTime as { callCount: number } | undefined)?.callCount).toBe(1);
  });
});

describe("Store — reset", () => {
  it("resetSession clears accumulated state for that session only", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));
    store.applyRecords("s2", batch([call({ sessionId: "s2" })]));
    vi.advanceTimersByTime(300);

    store.resetSession("s1");
    vi.advanceTimersByTime(300);

    expect(store.getCalls("s1")).toHaveLength(0);
    expect(store.getSession("s1")?.callCount).toBe(0);
    expect(store.getSession("s2")?.callCount).toBe(1);
  });
});

describe("Store — sidecar presence", () => {
  it("markSidecarPresent flips the relevant tier flag for that session only", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));
    store.applyRecords("s2", batch([call({ sessionId: "s2" })]));
    store.markSidecarPresent("s1", "cost");
    vi.advanceTimersByTime(300);

    expect(store.getSession("s1")?.tier).toMatchObject({ hasCostSamples: true });
    expect(store.getSession("s2")?.tier).toMatchObject({ hasCostSamples: false });
  });
});

describe("Store — listSessions", () => {
  it("lazily recomputes stale sessions on read without eagerly recomputing on every append", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));
    store.applyRecords("s2", batch([call({ sessionId: "s2" })]));

    // No debounce advance yet — nothing recomputed via the invalidator path.
    const sessions = store.listSessions();
    expect(sessions.map((s) => s.sessionId).sort()).toEqual(["s1", "s2"]);
    expect(sessions.every((s) => s.callCount === 1)).toBe(true);
  });
});
