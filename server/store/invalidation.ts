import type { WsServerMessage } from "../../shared/ws-protocol.js";

// Dirty-set + per-session debounce + emit hook (architecture §5.5, §7). This
// module never touches a socket — it only produces `WsServerMessage`-shaped
// values via `onFlush`; the actual `socket.send` wiring is #P3-1
// (`server/app.ts:sendInvalidation` already pins the wire shape it expects).

const DEFAULT_DEBOUNCE_MS = 300; // within the 200-500ms band CC's burst writes call for

export interface InvalidatorOptions {
  debounceMs?: number;
  onFlush(message: WsServerMessage): void;
}

export interface Invalidator {
  /** Mark a session dirty; its `session-updated` flush is (re)debounced. */
  markDirty(sessionId: string): void;
  /** A session was seen for the first time this run — fires immediately, no debounce. */
  markAdded(sessionId: string): void;
  /** Discovery found/lost files — fires immediately, no debounce (rare, not bursty). */
  markScanDirty(): void;
  /** Force-flush every pending debounced session immediately (e.g. before shutdown or in tests). */
  flushAll(): void;
  /** Cancel all pending timers without flushing. */
  stop(): void;
}

export function createInvalidator(options: InvalidatorOptions): Invalidator {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function flush(sessionId: string): void {
    timers.delete(sessionId);
    options.onFlush({ type: "session-updated", sessionId });
  }

  return {
    markDirty(sessionId: string): void {
      const existing = timers.get(sessionId);
      if (existing) clearTimeout(existing);
      timers.set(
        sessionId,
        setTimeout(() => flush(sessionId), debounceMs),
      );
    },

    markAdded(sessionId: string): void {
      options.onFlush({ type: "session-added", sessionId });
    },

    markScanDirty(): void {
      options.onFlush({ type: "scan-updated" });
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
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
