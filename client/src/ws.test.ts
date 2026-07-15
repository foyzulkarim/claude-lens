import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { connectWs, invalidateForMessage, type WsLike } from "./ws.js";

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
    expect(spy).toHaveBeenCalledExactlyOnceWith({ queryKey: ["metrics"] });
  });

  it("invalidates metrics and the session prefix on session-updated", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateForMessage(queryClient, { type: "session-updated", sessionId: "s1" });
    expect(spy).toHaveBeenNthCalledWith(1, { queryKey: ["metrics"] });
    expect(spy).toHaveBeenNthCalledWith(2, { queryKey: ["session", "s1"] });
    expect(spy).toHaveBeenCalledTimes(2);
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

  it("routes an inbound message through invalidateForMessage", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onmessage?.({ data: JSON.stringify({ type: "session-added", sessionId: "s1" }) });

    expect(spy).toHaveBeenCalledExactlyOnceWith({ queryKey: ["metrics"] });
  });

  it("ignores malformed frames without throwing", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    expect(() => sockets[0].onmessage?.({ data: "not json" })).not.toThrow();
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
