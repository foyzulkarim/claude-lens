import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { connectWs, INVALIDATION_COALESCE_MS, invalidateForMessage, type WsLike } from "./ws.js";

class FakeSocket implements WsLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  close(): void {
    this.closed = true;
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const createSocket = (): WsLike => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  return { sockets, createSocket };
}

describe("invalidateForMessage", () => {
  it("invalidates everything on scan-updated", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "scan-updated" });
    expect(spy).toHaveBeenCalledExactlyOnceWith();
  });

  it("invalidates the metrics prefix on session-added", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-added", sessionId: "s1" });
    // Aggregate metrics shift + the sessions list itself is stale — both
    // prefixes invalidated in one go (ARCH T7, A12).
    expect(spy).toHaveBeenCalledWith({ queryKey: ["metrics"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("invalidates the sessions prefix on session-added", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-added", sessionId: "s1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
  });

  it("invalidates metrics, the session prefix, the turn-inspector prefix, the sessions prefix, AND the gates prefix on session-updated", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-updated", sessionId: "s1" });
    expect(spy).toHaveBeenNthCalledWith(1, { queryKey: ["metrics"] });
    expect(spy).toHaveBeenNthCalledWith(2, { queryKey: ["session", "s1"] });
    expect(spy).toHaveBeenNthCalledWith(3, { queryKey: ["turn-inspector", "s1"] });
    expect(spy).toHaveBeenNthCalledWith(4, { queryKey: ["sessions"] });
    // Gates prefix invalidation — Report Card + Dashboard failure feed
    // (PR title's "live gate feeds" claim is broken without this).
    expect(spy).toHaveBeenNthCalledWith(5, { queryKey: ["gates"] });
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("invalidates the gates prefix on session-updated so Report Card + failure feed refetch", () => {
    // Pins the central claim of the PR title (#P4-12): a transcript append
    // for ANY session must invalidate the gates prefix so both the
    // per-session Report Card (`qk.gates(id)`) and the Dashboard failure
    // feed (`qk.gateFailures(...)`) refetch within their staleTime window
    // — not after it.
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-updated", sessionId: "s1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["gates"] });
  });

  it("invalidates only the matching detail key when two session IDs are mounted", () => {
    // T6 evidence: mounted detail queries for two IDs invalidate only
    // their own on a `session-updated` for one of them. TanStack Query's
    // prefix matching means a `["session"]` key matches all detail pages,
    // but the `qk.session(id)` exact key matches just the addressed one —
    // what the page-level query uses.
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-updated", sessionId: "s1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s1"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["session", "s2"] });
    // Same scoping for the Turn Inspector prefix — a `session-updated`
    // for `s1` must NOT invalidate a Turn Inspector mounted on `s2`.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s1"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s2"] });
  });

  it("invalidates the sessions prefix on session-updated", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-updated", sessionId: "s1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
  });

  it("does not invalidate the sessions prefix for non-session messages", () => {
    // Separation of concerns — only session-added / session-updated touch
    // the sessions prefix; scan-updated takes the all-queries path (no
    // prefix filter). A hypothetical future message that falls through the
    // exhaustive switch must NOT silently widen its scope to sessions.
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    // scan-updated: invalidateQueries() with no args (matches everything,
    // including sessions), but it's NOT a prefix-targeted invalidation.
    invalidateForMessage(queryClient, { type: "scan-updated" });
    expect(spy).toHaveBeenCalledExactlyOnceWith();

    // Unrecognized future message: switch's default branch logs and drops.
    spy.mockClear();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    invalidateForMessage(queryClient, { type: "future-message" } as unknown as WsServerMessage);
    expect(spy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("invalidates only the search-index prefix on session-prompts-changed (#P4-3)", () => {
    // Prompt-only mutation must not trigger metrics/sessions/detail churn
    // — ARCH A2. This is the dedicated message that lets the search panel
    // refresh without paying for a full session-updated fan-out.
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-prompts-changed", sessionId: "s1" });
    expect(spy).toHaveBeenCalledExactlyOnceWith({ queryKey: ["search-index"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["metrics"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["sessions"] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ["session", "s1"] });
  });

  it("warns and does nothing for an unrecognized message type", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    invalidateForMessage(queryClient, { type: "future-message" } as unknown as WsServerMessage);
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("connectWs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Backoff math involves jitter (±20%); pin it to the midpoint so timing
    // assertions aren't coincidentally sitting on Math.random()'s extremes.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens exactly one socket and invalidates everything on open", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });

    expect(sockets).toHaveLength(1);
    sockets[0].onopen?.();
    expect(spy).toHaveBeenCalledExactlyOnceWith();
  });

  it("routes an inbound message through the invalidation batcher", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-added", sessionId: "s1" }) });

    // Batched, not applied synchronously (#P4-20) — nothing fires until the
    // coalescing window elapses.
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS);

    // A single inbound `session-added` message triggers both metrics- and
    // sessions-prefix invalidations (aggregate metrics + the list itself
    // are stale). The router passes both through; this test guards the
    // connectWs→onmessage→batcher wiring, not the prefix set.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["metrics"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("coalesces multiple session-updated messages within one window into a single metrics/sessions invalidation, keeping each session's own detail invalidation", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    // Three concurrently-active sessions each flush within the same window —
    // this is the #P4-20 fan-out scenario (N sessions, N raw messages).
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-updated", sessionId: "s1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-updated", sessionId: "s2" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-updated", sessionId: "s3" }) });

    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS);

    // One shared metrics invalidation and one shared sessions invalidation —
    // not three of each — plus exactly one detail invalidation per session
    // (session detail + turn inspector, both keyed by sessionId).
    const metricsCalls = spy.mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: ["metrics"] }),
    );
    const sessionsCalls = spy.mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: ["sessions"] }),
    );
    expect(metricsCalls).toHaveLength(1);
    expect(sessionsCalls).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s2"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s3"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s2"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s3"] });
    // The gates prefix collapses across sessions (one shared invalidation).
    const gatesCalls = spy.mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: ["gates"] }),
    );
    expect(gatesCalls).toHaveLength(1);
    // 1 metrics + 1 sessions + 1 gates + 3 session detail + 3 turn-inspector = 9.
    expect(spy).toHaveBeenCalledTimes(9);
  });

  it("includes a message that arrives mid-window (after the timer is scheduled but before it fires)", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    // First message schedules the window's timer; a second message for a
    // DIFFERENT session arrives partway through the same window, before it
    // fires. Both must still land in the single flush — a regression that
    // reset `pending` per-enqueue or re-armed the timer per-message would
    // drop or indefinitely delay this second message.
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-updated", sessionId: "s1" }) });
    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS / 2);
    expect(spy).not.toHaveBeenCalled();
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-updated", sessionId: "s2" }) });

    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS / 2);

    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s2"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s2"] });
    const metricsCalls = spy.mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: ["metrics"] }),
    );
    expect(metricsCalls).toHaveLength(1);
  });

  it("collapses session-added and session-updated for the same session in one window into a single set of shared invalidations", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    // Both message types resolve to overlapping actions for the same
    // session — actionKey must collapse them to one entry per action kind
    // regardless of which message contributed it.
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-added", sessionId: "s1" }) });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-updated", sessionId: "s1" }) });

    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS);

    expect(spy).toHaveBeenCalledWith({ queryKey: ["metrics"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sessions"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["session", "s1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["turn-inspector", "s1"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["gates"] });
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it("does not apply pending batched invalidations after dispose", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    const dispose = connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-added", sessionId: "s1" }) });
    dispose();
    spy.mockClear();

    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores malformed frames without throwing", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    expect(() => sockets[0].onmessage?.({ data: "not json" })).not.toThrow();
    vi.advanceTimersByTime(INVALIDATION_COALESCE_MS);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reconnects with backoff after the socket closes", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    expect(sockets).toHaveLength(1);

    sockets[0].onclose?.();
    // Backoff base is 500ms; nothing should reconnect before that.
    vi.advanceTimersByTime(400);
    expect(sockets).toHaveLength(1);

    vi.advanceTimersByTime(400);
    expect(sockets).toHaveLength(2);
  });

  it("backs off further on consecutive failures", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    sockets[1].onclose?.();
    // Second attempt backs off further than the first (base * 2^1 = 1000ms);
    // 900ms alone must not be enough.
    vi.advanceTimersByTime(900);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(3);
  });

  it("caps the reconnect delay instead of doubling indefinitely", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });

    // Drive enough consecutive failures that uncapped doubling (500 * 2^attempt)
    // would exceed MAX_DELAY_MS (10s) well before attempt 5 (500*2^5=16000).
    for (let i = 0; i < 5; i++) {
      sockets[sockets.length - 1].onclose?.();
      vi.runOnlyPendingTimers();
    }
    expect(sockets).toHaveLength(6);

    // If the cap were broken, the next delay would be 500*2^5=16000ms; confirm
    // it reconnects well before that, proving Math.min(..., MAX_DELAY_MS) held.
    sockets[5].onclose?.();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(7);
  });

  it("resets the backoff counter after a successful open", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    sockets[1].onopen?.();
    sockets[1].onclose?.();
    // Backoff should be back to the base delay, not the escalated one.
    vi.advanceTimersByTime(600);
    expect(sockets).toHaveLength(3);
  });

  it("routes a transport error into the reconnect path", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onerror?.(new Error("boom"));
    expect(sockets[0].closed).toBe(true);

    sockets[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
  });

  it("stops reconnecting once disposed", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    const dispose = connectWs(queryClient, { url: "ws://test/ws", createSocket });
    expect(sockets).toHaveLength(1);

    dispose();
    expect(sockets[0].closed).toBe(true);

    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(1);
  });

  it("cancels an already-scheduled reconnect when disposed", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    const dispose = connectWs(queryClient, { url: "ws://test/ws", createSocket });
    // Puts a pending reconnect timer in flight (the harder disposal path —
    // dispose() must clearTimeout it, not just guard future open() calls).
    sockets[0].onclose?.();

    dispose();
    vi.advanceTimersByTime(20_000);
    expect(sockets).toHaveLength(1);
  });

  it("stops routing events to the query client once disposed", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    const dispose = connectWs(queryClient, { url: "ws://test/ws", createSocket });
    dispose();
    spy.mockClear();

    // A late-arriving event on the disposed socket must not reach the query
    // client — dispose() nulls all four handlers, not just onclose/onerror.
    sockets[0].onopen?.();
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "scan-updated" }) });

    expect(spy).not.toHaveBeenCalled();
  });
});
