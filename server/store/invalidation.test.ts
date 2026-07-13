import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { createInvalidator } from "./invalidation.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createInvalidator — per-session debounce", () => {
  it("coalesces a burst of markDirty calls for one session into a single flush", () => {
    const flushed: WsServerMessage[] = [];
    const invalidator = createInvalidator({ debounceMs: 300, onFlush: (m) => flushed.push(m) });

    invalidator.markDirty("s1");
    vi.advanceTimersByTime(100);
    invalidator.markDirty("s1");
    vi.advanceTimersByTime(100);
    invalidator.markDirty("s1");
    vi.advanceTimersByTime(299);
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([{ type: "session-updated", sessionId: "s1" }]);
  });

  it("debounces independent sessions independently", () => {
    const flushed: WsServerMessage[] = [];
    const invalidator = createInvalidator({ debounceMs: 300, onFlush: (m) => flushed.push(m) });

    invalidator.markDirty("s1");
    vi.advanceTimersByTime(150);
    invalidator.markDirty("s2");
    vi.advanceTimersByTime(150);
    // s1's timer (started at t=0) fires at t=300; s2's (started at t=150) fires at t=450.
    expect(flushed).toEqual([{ type: "session-updated", sessionId: "s1" }]);

    vi.advanceTimersByTime(150);
    expect(flushed).toEqual([
      { type: "session-updated", sessionId: "s1" },
      { type: "session-updated", sessionId: "s2" },
    ]);
  });

  it("markAdded and markScanDirty fire immediately, bypassing debounce", () => {
    const flushed: WsServerMessage[] = [];
    const invalidator = createInvalidator({ debounceMs: 300, onFlush: (m) => flushed.push(m) });

    invalidator.markAdded("s1");
    invalidator.markScanDirty();

    expect(flushed).toEqual([{ type: "session-added", sessionId: "s1" }, { type: "scan-updated" }]);
  });

  it("flushAll immediately flushes every pending session", () => {
    const flushed: WsServerMessage[] = [];
    const invalidator = createInvalidator({ debounceMs: 300, onFlush: (m) => flushed.push(m) });

    invalidator.markDirty("s1");
    invalidator.markDirty("s2");
    invalidator.flushAll();

    expect(flushed.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [
        { type: "session-updated", sessionId: "s1" },
        { type: "session-updated", sessionId: "s2" },
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );

    vi.advanceTimersByTime(1000);
    expect(flushed).toHaveLength(2); // no double-flush after the original timers would have fired
  });

  it("stop cancels pending timers without flushing", () => {
    const flushed: WsServerMessage[] = [];
    const invalidator = createInvalidator({ debounceMs: 300, onFlush: (m) => flushed.push(m) });

    invalidator.markDirty("s1");
    invalidator.stop();
    vi.advanceTimersByTime(1000);

    expect(flushed).toHaveLength(0);
  });
});
