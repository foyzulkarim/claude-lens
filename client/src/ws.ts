import type { QueryClient } from "@tanstack/react-query";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { qk } from "./api/queryKeys.js";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;
const JITTER_RATIO = 0.2;

/**
 * Structural mirror of the browser WebSocket API (assignable onopen/onclose/
 * onerror/onmessage + close()) — same "depend on nothing from the real
 * transport" approach as server/ws/broadcaster.ts's `WsSocket`, so this
 * module is fake-able in tests without a DOM environment (vitest here runs
 * under plain Node, see vitest.config.ts).
 */
export interface WsLike {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((err: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close(): void;
}

export interface ConnectWsOptions {
  /** Override the target URL (tests). Defaults to same-origin `/ws`. */
  url?: string;
  /** Override socket construction (tests). Defaults to `new WebSocket(url)`. */
  createSocket?: (url: string) => WsLike;
}

// Same-origin derivation: works unchanged against the Vite dev proxy
// (client/vite.config.ts proxies /ws to :4128) and against the prod Fastify
// server (same origin serves the SPA + /ws).
function defaultUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function defaultCreateSocket(url: string): WsLike {
  return new WebSocket(url) as unknown as WsLike;
}

/**
 * Maps a server invalidation message to the query-key prefixes it stales
 * (ARCH-react-shell.md "Message → prefix table"). Exported standalone so the
 * mapping is unit-testable without a socket.
 */
export function invalidateForMessage(queryClient: QueryClient, message: WsServerMessage): void {
  switch (message.type) {
    case "scan-updated":
      queryClient.invalidateQueries();
      return;
    case "session-added":
      // Aggregate metrics shift (a new session contributes to the spend /
      // turn-count series) and the session list itself is stale by
      // definition — invalidate both prefixes so every card refetches
      // without the page needing to thread its own subscriptions.
      queryClient.invalidateQueries({ queryKey: qk.prefixes.metrics });
      queryClient.invalidateQueries({ queryKey: qk.prefixes.sessions });
      return;
    case "session-updated":
      queryClient.invalidateQueries({ queryKey: qk.prefixes.metrics });
      queryClient.invalidateQueries({ queryKey: qk.prefixes.session(message.sessionId) });
      queryClient.invalidateQueries({ queryKey: qk.prefixes.sessions });
      return;
    default: {
      // Exhaustive check: a future 4th WsServerMessage variant fails
      // typecheck here instead of being silently dropped at runtime.
      const unhandled: never = message;
      console.warn("[ws] unrecognized message type", unhandled);
    }
  }
}

/**
 * Opens a reconnecting invalidation-bus WebSocket (architecture §7/§11): a
 * native WebSocket, hand-rolled exponential backoff with jitter, no library.
 * Every (re)connect invalidates everything once — the client's answer to
 * #P3-1's "missed invalidations aren't replayed on reconnect" open question.
 *
 * Returns a disposer; calling it closes the socket and suppresses further
 * reconnect attempts.
 */
export function connectWs(queryClient: QueryClient, options: ConnectWsOptions = {}): () => void {
  const url = options.url ?? defaultUrl();
  const createSocket = options.createSocket ?? defaultCreateSocket;

  let disposed = false;
  let attempt = 0;
  let socket: WsLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open(): void {
    if (disposed) return;
    socket = createSocket(url);

    socket.onopen = () => {
      attempt = 0;
      queryClient.invalidateQueries();
    };

    socket.onmessage = (event) => {
      let message: WsServerMessage;
      try {
        message = JSON.parse(event.data) as WsServerMessage;
      } catch {
        console.warn("[ws] malformed message", event.data);
        return;
      }
      invalidateForMessage(queryClient, message);
    };

    socket.onclose = () => {
      scheduleReconnect();
    };

    // A transport error precedes close for a dead connection; force close so
    // onclose's reconnect path is the single place backoff is scheduled.
    socket.onerror = () => {
      socket?.close();
    };
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
    const jitter = delay * JITTER_RATIO * (Math.random() * 2 - 1);
    attempt += 1;
    reconnectTimer = setTimeout(open, Math.max(0, delay + jitter));
  }

  open();

  return () => {
    disposed = true;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  };
}
