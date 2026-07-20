import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiCall } from "../../shared/types.js";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
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
  return {
    calls,
    prompts: [],
    toolResultBytes: [],
    compactions: [],
    duplicateCount: 0,
    malformedCount: 0,
  };
}

function makeStore(debounceMs = 300, opts: Partial<import("./store.js").StoreOptions> = {}) {
  const invalidations: WsServerMessage[] = [];
  const store = new Store({ debounceMs, onInvalidate: (m) => invalidations.push(m), ...opts });
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

describe("Store — listCalls", () => {
  it("concatenates raw calls across sessions in insertion order, with no recompute needed", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    store.applyRecords("s2", batch([call({ sessionId: "s2", messageId: "m2" })]));
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m3" })]));

    // No debounce advance — calls are raw, listCalls() must be current regardless.
    const calls = store.listCalls();
    expect(calls.map((c) => c.messageId)).toEqual(["m1", "m3", "m2"]);
  });
});

describe("Store — listTurns", () => {
  it("lazily recomputes stale sessions and concatenates derived turns across sessions", () => {
    const { store } = makeStore();
    // A turn only derives when a call has a matching prompt (derive-turns.ts
    // assigns each call to the latest preceding prompt in its session) — a
    // bare call() with no prompt yields zero turns, so each batch here needs one.
    const prompt1 = {
      sessionId: "s1",
      promptId: "p1",
      text: "hi",
      timestamp: "2026-07-13T00:00:00.000Z",
    };
    const prompt2 = {
      sessionId: "s2",
      promptId: "p2",
      text: "hi",
      timestamp: "2026-07-13T00:00:00.000Z",
    };
    store.applyRecords("s1", {
      calls: [call({ sessionId: "s1", messageId: "m1" })],
      prompts: [prompt1],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    store.applyRecords("s2", {
      calls: [call({ sessionId: "s2", messageId: "m2" })],
      prompts: [prompt2],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });

    // No debounce advance yet — nothing recomputed via the invalidator path.
    const turns = store.listTurns();
    expect(turns.map((t) => t.sessionId).sort()).toEqual(["s1", "s2"]);
  });
});
describe("Store — recompute threading", () => {
  it("costComputed reflects injected pricer", () => {
    const pricer = () => 1.5;
    const pricing = {
      "claude-sonnet-5": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
    };
    const { store } = makeStore(300, { pricer, pricing });

    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));
    vi.advanceTimersByTime(300);

    const session = store.getSession("s1");
    expect(session?.costComputed).toBe(1.5);
  });

  it("changing pricing triggers recompute", () => {
    const pricerA = () => 1;
    const pricerB = () => 5;
    const pricing = {
      "claude-sonnet-5": { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
    };
    const { store } = makeStore(300, { pricer: pricerA, pricing });

    store.applyRecords("s1", batch([call({ sessionId: "s1" })]));
    vi.advanceTimersByTime(300);
    expect(store.getSession("s1")?.costComputed).toBe(1);

    store.updatePricing({ pricer: pricerB });
    store.recompute("s1");

    expect(store.getSession("s1")?.costComputed).toBe(5);
  });

  it("existing derive-turns/derive-session invariants preserved", () => {
    const pricer = () => 0;
    const pricing = {};
    const { store } = makeStore(300, { pricer, pricing });

    const prompt1 = {
      sessionId: "s1",
      promptId: "p1",
      text: "hi",
      timestamp: "2026-07-13T00:00:00.000Z",
    };
    store.applyRecords("s1", {
      calls: [call({ sessionId: "s1", messageId: "m1" })],
      prompts: [prompt1],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);

    const turns = store.getTurns("s1");
    const session = store.getSession("s1");

    expect(turns).toHaveLength(1);
    expect(turns[0].promptId).toBe("p1");
    expect(session?.callCount).toBe(1);
    expect(session?.turnCount).toBe(1);
  });
});

describe("Store — getSessionSnapshot (#P4-5 T2)", () => {
  it("returns undefined for an unknown session id", () => {
    const { store } = makeStore();
    expect(store.getSessionSnapshot("does-not-exist")).toBeUndefined();
  });

  it("returns a coherent snapshot with session, calls, turns, prompts, toolResults, compactions", () => {
    const { store } = makeStore();
    const prompt = {
      sessionId: "s1",
      promptId: "p1",
      text: "hi",
      timestamp: "2026-07-13T00:00:00.000Z",
    };
    const toolResult = {
      sessionId: "s1",
      promptId: "p1",
      toolUseId: "t1",
      bytes: 100,
      isError: false,
    };
    const compaction = { sessionId: "s1", timestamp: "2026-07-13T00:01:00.000Z" };
    store.applyRecords("s1", {
      calls: [call({ sessionId: "s1", messageId: "m1" })],
      prompts: [prompt],
      toolResultBytes: [toolResult],
      compactions: [compaction],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);

    const snap = store.getSessionSnapshot("s1");

    expect(snap).toBeDefined();
    expect(snap?.session.callCount).toBe(1);
    expect(snap?.calls).toHaveLength(1);
    expect(snap?.turns).toHaveLength(1);
    expect(snap?.prompts).toEqual([prompt]);
    expect(snap?.toolResults).toEqual([toolResult]);
    expect(snap?.compactions).toEqual([compaction]);
    // Logical turn count groups sidechains under the parent prompt.
    expect(snap?.session.turnCount).toBe(1);
  });

  it("returns an honest empty snapshot for a known session with no records", () => {
    const { store } = makeStore();
    // A "known" session is created on first applyRecords; after a reset we
    // want the same surface, so seed + reset + read.
    store.applyRecords("s-empty", batch([]));
    vi.advanceTimersByTime(300);
    store.resetSession("s-empty");
    vi.advanceTimersByTime(300);

    const snap = store.getSessionSnapshot("s-empty");

    expect(snap).toBeDefined();
    expect(snap?.calls).toEqual([]);
    expect(snap?.turns).toEqual([]);
    expect(snap?.prompts).toEqual([]);
    expect(snap?.toolResults).toEqual([]);
    expect(snap?.compactions).toEqual([]);
    expect(snap?.session.callCount).toBe(0);
    expect(snap?.session.turnCount).toBe(0);
  });

  it("resetSession clears every compact record from the next snapshot", () => {
    const { store } = makeStore();
    store.applyRecords("s1", {
      calls: [call({ sessionId: "s1", messageId: "m1" })],
      prompts: [],
      toolResultBytes: [],
      compactions: [{ sessionId: "s1" }],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);
    expect(store.getSessionSnapshot("s1")?.compactions).toHaveLength(1);

    store.resetSession("s1");
    store.applyRecords("s1", {
      calls: [call({ sessionId: "s1", messageId: "m2" })],
      prompts: [],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);

    const snap = store.getSessionSnapshot("s1");
    expect(snap?.compactions).toEqual([]);
    expect(snap?.calls.map((c) => c.messageId)).toEqual(["m2"]);
  });

  it("forces a fresh recompute so the snapshot reflects pending dirty state", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    // No vi.advanceTimersByTime here — debounce hasn't flushed yet.

    // Snapshot still reflects the latest applyRecords because it recomputes
    // synchronously, independent of the debounce.
    const snap = store.getSessionSnapshot("s1");
    expect(snap?.session.callCount).toBe(1);
    expect(snap?.calls).toHaveLength(1);
  });

  it("derives logical rollups (turnCount + maxTurnCostComputed) over grouped prompt turns", () => {
    const { store } = makeStore();
    const flatPricer = (u: { inputTokens: number }) => u.inputTokens * 0.001;

    store.updatePricing({ pricer: flatPricer });
    store.applyRecords("s1", {
      calls: [
        call({
          sessionId: "s1",
          messageId: "m1",
          promptId: "p1",
          usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
        }),
        // sidechain on the same promptId — must roll into p1's logical turn
        call({
          sessionId: "s1",
          messageId: "m2",
          promptId: "p1",
          isSidechain: true,
          usage: { inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 },
        }),
      ],
      prompts: [
        {
          sessionId: "s1",
          promptId: "p1",
          text: "do thing",
          timestamp: "2026-07-13T00:00:00.000Z",
        },
      ],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);

    const snap = store.getSessionSnapshot("s1");
    // Two derived `Turn` records (one main, one sidechain) collapse to one
    // logical prompt turn — see ARCH-session-detail-page.md A4 / T2.
    expect(snap?.session.turnCount).toBe(1);
    // cost = (100 + 50) * 0.001 = 0.15 — both segments counted exactly once.
    expect(snap?.session.costComputed).toBeCloseTo(0.15);
    expect(snap?.session.maxTurnCostComputed).toBeCloseTo(0.15);
  });
});

describe("Store — session-prompts-changed emit (#P4-3, ARCH A2/A8)", () => {
  function promptBatch(sessionId: string, promptId: string, text: string): ParseTranscriptResult {
    return {
      calls: [call({ sessionId, messageId: `m-${promptId}`, promptId })],
      prompts: [{ sessionId, promptId, text, timestamp: "2026-07-13T00:00:00.000Z" }],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    };
  }

  it("emits BOTH session-updated AND session-prompts-changed when prompts were appended", () => {
    const { store, invalidations } = makeStore();
    store.applyRecords("s1", promptBatch("s1", "p1", "first prompt"));
    vi.advanceTimersByTime(300);

    const types = invalidations.map((m) => m.type);
    expect(types).toContain("session-updated");
    expect(types).toContain("session-prompts-changed");

    const promptMsg = invalidations.find((m) => m.type === "session-prompts-changed");
    expect(promptMsg).toEqual({ type: "session-prompts-changed", sessionId: "s1" });
  });

  it("does NOT emit session-prompts-changed when applyRecords had zero prompts", () => {
    const { store, invalidations } = makeStore();
    // No prompts in the batch — just a follow-up call.
    store.applyRecords("s1", {
      calls: [call({ sessionId: "s1", messageId: "m2", promptId: "p1" })],
      prompts: [],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);

    const types = invalidations.map((m) => m.type);
    expect(types).toContain("session-updated");
    expect(types).not.toContain("session-prompts-changed");
  });

  it("emits both messages only ONCE per debounce window even with multiple applyRecords", () => {
    const { store, invalidations } = makeStore();
    store.applyRecords("s1", promptBatch("s1", "p1", "first"));
    store.applyRecords("s1", promptBatch("s1", "p2", "second"));
    vi.advanceTimersByTime(300);

    const promptMsgs = invalidations.filter((m) => m.type === "session-prompts-changed");
    expect(promptMsgs).toHaveLength(1);
  });
});

describe("Store — buildSearchSnapshot per-session error handling (#P4-3)", () => {
  it("skips a session whose recompute throws — other healthy sessions still appear in the index", () => {
    const { store } = makeStore();

    // Two healthy sessions
    store.applyRecords("s-ok-1", {
      calls: [call({ sessionId: "s-ok-1", messageId: "m1", promptId: "p1" })],
      prompts: [
        {
          sessionId: "s-ok-1",
          promptId: "p1",
          text: "healthy one",
          timestamp: "2026-07-13T00:00:00.000Z",
        },
      ],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    store.applyRecords("s-ok-2", {
      calls: [call({ sessionId: "s-ok-2", messageId: "m2", promptId: "p1" })],
      prompts: [
        {
          sessionId: "s-ok-2",
          promptId: "p1",
          text: "healthy two",
          timestamp: "2026-07-13T00:00:01.000Z",
        },
      ],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    // One corrupt session — make recompute() throw via spy
    store.applyRecords("s-bad", {
      calls: [call({ sessionId: "s-bad", messageId: "m3", promptId: "p1" })],
      prompts: [
        {
          sessionId: "s-bad",
          promptId: "p1",
          text: "would be here",
          timestamp: "2026-07-13T00:00:02.000Z",
        },
      ],
      toolResultBytes: [],
      compactions: [],
      duplicateCount: 0,
      malformedCount: 0,
    });
    vi.advanceTimersByTime(300);

    // For the bad session, clear state.session so the build loop is
    // forced to call recompute() — then patch the `recompute` method
    // on the Store instance to throw for s-bad. The other sessions take
    // the "already fresh" path and use their state.session as-is.
    const storeAny = store as unknown as {
      sessions: Map<string, { session: unknown; prompts: unknown; turns: unknown }>;
      recompute(sessionId: string): void;
    };
    const badState = storeAny.sessions.get("s-bad");
    if (badState) badState.session = null;

    const origRecompute = storeAny.recompute.bind(store);
    storeAny.recompute = (sessionId: string) => {
      if (sessionId === "s-bad") throw new Error("simulated deriveTurns invariant");
      origRecompute(sessionId);
    };

    const snap = store.buildSearchSnapshot();

    // Restore the original method so the spy doesn't leak into other tests.
    storeAny.recompute = origRecompute;

    // Both healthy sessions appear; the bad one is dropped.
    const sessionIds = snap.prompts.map((p) => p.sessionId);
    expect(sessionIds).toContain("s-ok-1");
    expect(sessionIds).toContain("s-ok-2");
    expect(sessionIds).not.toContain("s-bad");
  });
});

describe("Store — premium sidecars (#P4-13)", () => {
  const costSample = (overrides: Record<string, unknown> = {}) => ({
    sessionId: "s1",
    timestamp: "2026-07-13T00:00:01.000Z",
    costDeltaUsd: 0.25,
    cumulativeCostUsd: 0.25,
    apiDurationMs: 4200,
    contextPct: 33,
    linesAdded: 5,
    linesRemoved: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  });

  it("applyCostSamples flips costBasis to observed and threads costObserved through", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    vi.advanceTimersByTime(300);
    expect(store.getSession("s1")?.tier.costBasis).toBe("computed");
    expect(store.getSession("s1")?.costObserved).toBeUndefined();

    store.applyCostSamples("s1", [costSample()]);
    vi.advanceTimersByTime(300);

    const s = store.getSession("s1");
    expect(s?.tier.costBasis).toBe("observed");
    expect(s?.tier.hasCostSamples).toBe(true);
    expect(s?.costObserved).toBeCloseTo(0.25);
    expect(s?.linesAdded).toBe(5);
    expect(s?.contextPctObserved).toBeCloseTo(0.33);
    // The observed apiMs is attributed onto the fleet-visible call too.
    expect(store.getCalls("s1")[0]?.apiMs).toBe(4200);
  });

  it("applyCostLog fans a global row out to its session and flips costBasis", () => {
    const { store } = makeStore();
    store.applyRecords("s1", batch([call({ sessionId: "s1", messageId: "m1" })]));
    vi.advanceTimersByTime(300);

    store.applyCostLog([
      {
        sessionId: "s1",
        timestamp: "2026-07-13T00:00:00.000Z",
        costUsd: 1.75,
        durationMs: 5000,
        model: "claude-sonnet-5",
        dir: "/repo",
        contextPct: 40,
        cacheRead: 0,
        cacheWrite: 0,
        linesAdded: 9,
        linesRemoved: 3,
      },
    ]);
    vi.advanceTimersByTime(300);

    const s = store.getSession("s1");
    expect(s?.tier.costBasis).toBe("observed");
    expect(s?.tier.hasCostLog).toBe(true);
    expect(s?.costObserved).toBeCloseTo(1.75);
  });

  it("leaves transcript-only sessions with no observed fields", () => {
    const { store } = makeStore();
    store.applyRecords("s2", batch([call({ sessionId: "s2", messageId: "m2" })]));
    vi.advanceTimersByTime(300);
    const s = store.getSession("s2");
    expect(s?.tier.costBasis).toBe("computed");
    expect(s?.costObserved).toBeUndefined();
    expect(store.getCalls("s2")[0]?.apiMs).toBeUndefined();
  });
});
