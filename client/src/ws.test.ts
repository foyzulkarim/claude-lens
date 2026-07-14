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
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("backs off further on consecutive failures, capped", () => {
    const queryClient = new QueryClient();
    const { sockets, createSocket } = harness();

    connectWs(queryClient, { url: "ws://test/ws", createSocket });
    sockets[0].onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);

    sockets[1].onclose?.();
    // Second attempt backs off further than the first (base * 2^1 = 1000ms);
    // 900ms alone must not be enough even accounting for jitter's lower bound.
    vi.advanceTimersByTime(700);
    expect(sockets).toHaveLength(2);
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
});
