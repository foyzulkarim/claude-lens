import type { QueryClient } from "@tanstack/react-query";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { qk } from "./api/queryKeys.js";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;
const JITTER_RATIO = 0.2;

/**
 * Coalescing window for inbound WS messages (#P4-20): the store debounces
 * invalidation *per session* (~300ms), so several concurrently-active
 * sessions each independently emit a `session-updated` within roughly the
 * same window. Routing every message straight into `invalidateQueries`
 * turned N active sessions into N redundant dashboard-wide `metrics`/
 * `sessions` prefix invalidations per window instead of one. Batching
 * inbound messages over this window and deduping their resulting
 * invalidation actions (below) collapses that back to one.
 */
export const INVALIDATION_COALESCE_MS = 200;

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
  // Adapter object (review TS-4) — preferred over `new WebSocket(url)
  // as unknown as WsLike`, which the type system can't verify. The
  // browser `WebSocket` callbacks all receive `Event`s with extra
  // properties the `WsLike` interface intentionally narrows to its
  // minimum surface; the adapter forwards each event into the
  // reassignable handler slots without forcing the consumer to know
  // the browser's full event shape.
  const native = new WebSocket(url);
  const adapter: WsLike = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    close: () => native.close(),
  };
  native.onopen = () => adapter.onopen?.();
  native.onclose = () => adapter.onclose?.();
  // The browser supplies a `CloseEvent` for `onclose` and a generic
  // `Event` for `onerror`; consumers in this module only react to the
  // *fact* that they fired, so we drop the event payload here.
  native.onerror = () => adapter.onerror?.(undefined);
  // `MessageEvent.data` is the only field the reconnect / parse path
  // reads; pass the event through and consumers extract `event.data`.
  native.onmessage = (event) => adapter.onmessage?.(event);
  return adapter;
}

/**
 * One query-invalidation effect. Deliberately data, not a closure — a batch
 * of messages (see `InvalidationBatcher` below) reduces to a `Map` keyed by
 * `actionKey`, so N messages that resolve to the same action (e.g. every
 * `session-updated` in a window wants the same `metrics` prefix) collapse to
 * one `applyInvalidationAction` call instead of N.
 */
type InvalidationAction =
  | { kind: "all" }
  | { kind: "metrics" }
  | { kind: "sessions" }
  | { kind: "session"; sessionId: string }
  | { kind: "turnInspectorSession"; sessionId: string }
  | { kind: "gates" }
  | { kind: "searchIndex" }
  | { kind: "health" };

function actionKey(action: InvalidationAction): string {
  switch (action.kind) {
    case "session":
      return `session:${action.sessionId}`;
    case "turnInspectorSession":
      return `turnInspectorSession:${action.sessionId}`;
    case "all":
    case "metrics":
    case "sessions":
    case "gates":
    case "searchIndex":
    case "health":
      return action.kind;
  }
}

/**
 * Maps a server invalidation message to the invalidation actions it implies
 * (ARCH-react-shell.md "Message → prefix table").
 */
function actionsForMessage(message: WsServerMessage): InvalidationAction[] {
  switch (message.type) {
    case "scan-updated":
      return [{ kind: "all" }];
    case "session-added":
      // Aggregate metrics shift (a new session contributes to the spend /
      // turn-count series) and the session list itself is stale by
      // definition — invalidate both prefixes so every card refetches
      // without the page needing to thread its own subscriptions. The
      // Data Health page (#P4-14) also needs a fresh read — a new
      // session contributes to fleet coverage counts.
      return [{ kind: "metrics" }, { kind: "sessions" }, { kind: "health" }];
    case "session-updated":
      // Per-session invalidation (ARCH T5, #P4-5): mounted detail queries
      // for THIS session refetch; the metrics/list paths invalidate too
      // because the row's badge/cost can shift as a side effect of the
      // append. The Turn Inspector is keyed under its own
      // `["turn-inspector", sessionId, ...]` prefix (not `qk.session`), so
      // it needs its own action — without this, an open inspector would
      // stay stale until a manual remount or a `scan-updated` arrived.
      // The gates prefix invalidates both the per-session Report Card
      // (`qk.gates(id)`) AND the Dashboard failure feed
      // (`qk.gateFailures(...)`) — without this, the PR title's
      // "live gate feeds" claim is broken (Report Card `staleTime: 5min`,
      // Dashboard feed `staleTime: 60s`). The Data Health page (#P4-14)
      // also invalidates: an append changes per-session dedup/malformed
      // counters, so without this the page would be stale during a live
      // transcript write.
      return [
        { kind: "metrics" },
        { kind: "session", sessionId: message.sessionId },
        { kind: "turnInspectorSession", sessionId: message.sessionId },
        { kind: "sessions" },
        { kind: "gates" },
        { kind: "health" },
      ];
    case "session-prompts-changed":
      // Prompt-only mutation (#P4-3, ARCH A2): the search index is the
      // only thing that depends on prompts, so we invalidate just that
      // prefix instead of falling back to the coarse session-updated.
      // Saves a round-trip on prompt-only appends during a live session.
      return [{ kind: "searchIndex" }];
    default: {
      // Exhaustive check: a future 4th WsServerMessage variant fails
      // typecheck here instead of being silently dropped at runtime.
      const unhandled: never = message;
      console.warn("[ws] unrecognized message type", unhandled);
      return [];
    }
  }
}

function applyInvalidationAction(queryClient: QueryClient, action: InvalidationAction): void {
  switch (action.kind) {
    case "all":
      queryClient.invalidateQueries();
      return;
    case "metrics":
      queryClient.invalidateQueries({ queryKey: qk.prefixes.metrics });
      return;
    case "sessions":
      queryClient.invalidateQueries({ queryKey: qk.prefixes.sessions });
      return;
    case "session":
      queryClient.invalidateQueries({ queryKey: qk.session(action.sessionId) });
      return;
    case "turnInspectorSession":
      queryClient.invalidateQueries({
        queryKey: qk.prefixes.turnInspectorForSession(action.sessionId),
      });
      return;
    case "gates":
      // Invalidate every gate-keyed query: per-session Report Cards
      // (`qk.gates(id)`) and the Dashboard failure feed
      // (`qk.gateFailures(...)`). Both share the `["gates"]` literal
      // prefix in queryKeys.ts. Server-side the cache is already
      // evicted by the broadcaster — this client-side invalidation
      // triggers refetches so mounted consumers see the fresh score
      // within `staleTime` of the append, not after it.
      queryClient.invalidateQueries({ queryKey: qk.prefixes.gates });
      return;
    case "searchIndex":
      queryClient.invalidateQueries({ queryKey: qk.prefixes.searchIndex });
      return;
    case "health":
      // #P4-14: invalidate the Data Health page's single query key
      // (`["health"]`) so a mounted page refetches with the latest
      // fleet rollup. `scan-updated`'s `all` action already covers
      // this via `queryClient.invalidateQueries()` with no key.
      queryClient.invalidateQueries({ queryKey: qk.prefixes.health });
      return;
    default: {
      // Exhaustive check, mirroring actionsForMessage's switch above: a
      // future 5th InvalidationAction variant fails typecheck here instead
      // of silently no-oping at runtime.
      const unhandled: never = action;
      console.warn("[ws] unhandled invalidation action", unhandled);
    }
  }
}

/**
 * Applies a single message's invalidation actions immediately, in the same
 * order `actionsForMessage` returns them. Exported standalone (and kept
 * synchronous/uncoalesced) so the message → action mapping stays
 * unit-testable without a socket or fake timers; `connectWs` below batches
 * multiple inbound messages through the same action layer instead of calling
 * this per-message, so it isn't the one actually wired to `onmessage`.
 */
export function invalidateForMessage(queryClient: QueryClient, message: WsServerMessage): void {
  for (const action of actionsForMessage(message)) {
    applyInvalidationAction(queryClient, action);
  }
}

/**
 * Batches inbound messages over `INVALIDATION_COALESCE_MS` and flushes their
 * deduped invalidation actions once per window (#P4-20) — the fix for
 * per-session fan-out: N `session-updated` messages in one window still each
 * get their own `session:<id>` detail invalidation, but only one shared
 * `metrics`/`sessions` prefix invalidation instead of N.
 */
function createInvalidationBatcher(queryClient: QueryClient, delayMs: number) {
  const pending = new Map<string, InvalidationAction>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    timer = null;
    for (const action of pending.values()) applyInvalidationAction(queryClient, action);
    pending.clear();
  }

  return {
    enqueue(message: WsServerMessage): void {
      for (const action of actionsForMessage(message)) {
        pending.set(actionKey(action), action);
      }
      if (timer === null) {
        timer = setTimeout(flush, delayMs);
      }
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
  };
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
  const batcher = createInvalidationBatcher(queryClient, INVALIDATION_COALESCE_MS);

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
      batcher.enqueue(message);
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
    batcher.dispose();
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
