import type { WsServerMessage } from "../../shared/ws-protocol.js";

// Dirty-set + per-session debounce + emit hook (architecture §5.5, §7). This
// module never touches a socket — it only produces `WsServerMessage`-shaped
// values via `onFlush`; the actual `socket.send` fan-out lives in
// `server/ws/broadcaster.ts`, wired to `onFlush` by cli.ts (#P3-1).

const DEFAULT_DEBOUNCE_MS = 300; // within the 200-500ms band CC's burst writes call for

export interface InvalidatorOptions {
  debounceMs?: number;
  onFlush(message: WsServerMessage): void;
}

export interface Invalidator {
  /** Mark a session dirty; its `session-updated` flush is (re)debounced. No-op after `stop()`. */
  markDirty(sessionId: string): void;
  /** A session was seen for the first time this run — fires immediately, no debounce. No-op after `stop()`. */
  markAdded(sessionId: string): void;
  /** Discovery found/lost files — fires immediately, no debounce (rare, not bursty). No-op after `stop()`. */
  markScanDirty(): void;
  /** Force-flush every pending debounced session immediately (e.g. before shutdown or in tests). */
  flushAll(): void;
  /** Cancel all pending timers and reject any further scheduling — a hard boundary, not just a timer sweep. */
  stop(): void;
}

export function createInvalidator(options: InvalidatorOptions): Invalidator {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  // onFlush can run arbitrary caller code (Store.recompute -> an injected
  // #P2-8 pricer, then the caller's onInvalidate -> a future WS send in
  // #P3-1) from inside a setTimeout callback. An uncaught throw there would
  // be an uncaught exception that crashes the whole process — matching the
  // "consumer callback error must not escape" convention already used by
  // poller.ts/tailer.ts for the same reason.
  function safeOnFlush(message: WsServerMessage): void {
    try {
      options.onFlush(message);
    } catch (err) {
      console.error("[invalidation] onFlush threw", err);
    }
  }

  function flush(sessionId: string): void {
    timers.delete(sessionId);
    safeOnFlush({ type: "session-updated", sessionId });
  }

  return {
    markDirty(sessionId: string): void {
      if (stopped) return;
      const existing = timers.get(sessionId);
      if (existing) clearTimeout(existing);
      timers.set(
        sessionId,
        setTimeout(() => flush(sessionId), debounceMs),
      );
    },

    markAdded(sessionId: string): void {
      if (stopped) return;
      safeOnFlush({ type: "session-added", sessionId });
    },

    markScanDirty(): void {
      if (stopped) return;
      safeOnFlush({ type: "scan-updated" });
    },

    flushAll(): void {
      const pending = [...timers.keys()];
      for (const sessionId of pending) {
        const timer = timers.get(sessionId);
        if (timer) clearTimeout(timer);
        flush(sessionId);
      }
    },

    stop(): void {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
