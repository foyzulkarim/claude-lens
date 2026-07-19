import type { WsServerMessage } from "../../shared/ws-protocol.js";

// The fan-out seam for the invalidation bus (architecture §7). Ingest produces
// a single `onInvalidate(message)` callback (server/ingest/pipeline.ts); this
// object owns the set of connected `/ws` sockets and delivers each message to
// all of them. Deliberately framework-agnostic — it depends on nothing from
// Fastify or `ws`, only a structural `{ send, readyState }` socket — so it's
// unit-testable with a fake and so `server/` transport types never leak in.
//
// Built as a closure returning an object literal (same style as
// store/invalidation.ts) so `broadcaster.broadcast` can be detached and passed
// straight as `startIngest`'s `onInvalidate` without any `this` binding.

// `ws`/browser WebSocket readyState for an open connection. Hardcoded rather
// than imported so this module stays transport-free.
const OPEN = 1;

export interface WsSocket {
  send(data: string): void;
  readyState: number;
}

export interface Broadcaster {
  /** Register a connected socket. */
  add(socket: WsSocket): void;
  /** Deregister a socket (on close or error). */
  remove(socket: WsSocket): void;
  /**
   * Serialize once and deliver to every OPEN socket. Never throws: a single
   * socket's `send` failure is swallowed so it can neither abort the fan-out to
   * healthy sockets nor escape. This runs inside invalidation.ts's
   * setTimeout/safeOnFlush, where an uncaught throw would crash the process —
   * same "consumer callback error must not escape" convention as
   * poller.ts/tailer.ts/invalidation.ts.
   *
   * In-process subscribers registered via `subscribe` fire on the same
   * `message` — fan-out happens before (or interleaved with) socket
   * delivery; an in-process subscriber that throws is caught so the WS
   * fan-out never aborts (same convention as the socket path).
   */
  broadcast(message: WsServerMessage): void;
  /**
   * Register an in-process subscriber. Fires synchronously inside
   * `broadcast`. Returns an unsubscribe function. Used by the gates cache
   * (ARCH-p4-12 §Cross-Cutting) to evict per-session summaries on the
   * same WS bus the sockets read.
   */
  subscribe(callback: (message: WsServerMessage) => void): () => void;
  /** Number of currently-registered sockets. */
  size(): number;
}

export function createBroadcaster(): Broadcaster {
  const sockets = new Set<WsSocket>();
  const subscribers = new Set<(message: WsServerMessage) => void>();

  return {
    add(socket: WsSocket): void {
      sockets.add(socket);
    },

    remove(socket: WsSocket): void {
      sockets.delete(socket);
    },

    subscribe(callback): () => void {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },

    broadcast(message: WsServerMessage): void {
      // In-process subscribers first — their work (cache eviction, etc.)
      // is bounded and fast. A throwing subscriber must not abort the WS
      // fan-out, matching the socket-side convention immediately below.
      for (const subscriber of subscribers) {
        try {
          subscriber(message);
        } catch (err) {
          console.error("[broadcaster] subscriber threw", err);
        }
      }
      const payload = JSON.stringify(message);
      for (const socket of sockets) {
        if (socket.readyState !== OPEN) continue;
        try {
          socket.send(payload);
        } catch (err) {
          console.error("[broadcaster] socket.send threw", err);
        }
      }
    },

    size(): number {
      return sockets.size;
    },
  };
}
