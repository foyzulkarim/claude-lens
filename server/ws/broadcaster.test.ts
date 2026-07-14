import { describe, expect, it } from "vitest";
import type { WsServerMessage } from "../../shared/ws-protocol.js";
import { type Broadcaster, createBroadcaster, type WsSocket } from "./broadcaster.js";

const OPEN = 1;
const CLOSED = 3;

interface FakeSocket extends WsSocket {
  sent: string[];
}

function fakeSocket(readyState = OPEN): FakeSocket {
  return {
    readyState,
    sent: [],
    send(data: string): void {
      this.sent.push(data);
    },
  };
}

const UPDATED: WsServerMessage = { type: "session-updated", sessionId: "s1" };

function only(broadcaster: Broadcaster, message: WsServerMessage): string {
  broadcaster.broadcast(message);
  return JSON.stringify(message);
}

describe("createBroadcaster", () => {
  it("delivers each message once to every added OPEN socket, serialized", () => {
    const broadcaster = createBroadcaster();
    const a = fakeSocket();
    const b = fakeSocket();
    broadcaster.add(a);
    broadcaster.add(b);

    const payload = only(broadcaster, UPDATED);

    expect(a.sent).toEqual([payload]);
    expect(b.sent).toEqual([payload]);
  });

  it("skips sockets that are not OPEN", () => {
    const broadcaster = createBroadcaster();
    const open = fakeSocket(OPEN);
    const closing = fakeSocket(CLOSED);
    broadcaster.add(open);
    broadcaster.add(closing);

    broadcaster.broadcast(UPDATED);

    expect(open.sent).toHaveLength(1);
    expect(closing.sent).toHaveLength(0);
  });

  it("isolates a throwing socket — others still receive and broadcast does not throw", () => {
    const broadcaster = createBroadcaster();
    const bad: WsSocket = {
      readyState: OPEN,
      send() {
        throw new Error("boom");
      },
    };
    const good = fakeSocket();
    broadcaster.add(bad);
    broadcaster.add(good);

    expect(() => broadcaster.broadcast(UPDATED)).not.toThrow();
    expect(good.sent).toEqual([JSON.stringify(UPDATED)]);
  });

  it("stops delivering to a removed socket", () => {
    const broadcaster = createBroadcaster();
    const a = fakeSocket();
    broadcaster.add(a);
    broadcaster.remove(a);

    broadcaster.broadcast(UPDATED);

    expect(a.sent).toHaveLength(0);
  });

  it("tracks size across add and remove", () => {
    const broadcaster = createBroadcaster();
    const a = fakeSocket();
    const b = fakeSocket();

    expect(broadcaster.size()).toBe(0);
    broadcaster.add(a);
    broadcaster.add(b);
    expect(broadcaster.size()).toBe(2);
    broadcaster.remove(a);
    expect(broadcaster.size()).toBe(1);
  });
});
