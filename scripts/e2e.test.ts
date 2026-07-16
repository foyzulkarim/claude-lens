import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPortFree,
  createCleanup,
  installInterruptHandlers,
  type ManagedChild,
  parsePort,
  type SignalHost,
  startChild,
  stopChild,
  waitForReady,
} from "./e2e.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function managedChild(
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  options: { output?: string; exited?: boolean } = {},
): ManagedChild {
  return {
    name: "test child",
    process: { pid: 12345 } as ChildProcess,
    output: options.output ?? "",
    done,
    exited: options.exited ?? false,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runner configuration", () => {
  it("parses the default and an explicit valid port", () => {
    expect(parsePort({})).toBe(4200);
    expect(parsePort({ CLAUDE_LENS_E2E_PORT: "54321" })).toBe(54321);
  });

  it.each(["0", "65536", "1.5", "not-a-port"])("rejects invalid port %s", (value) => {
    expect(() => parsePort({ CLAUDE_LENS_E2E_PORT: value })).toThrow("integer between 1 and 65535");
  });

  it("reports an occupied port with the underlying bind code", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server has no TCP port");
    try {
      await expect(assertPortFree(address.port)).rejects.toThrow(/already occupied \(EADDRINUSE:/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("child termination", () => {
  it("clears the losing stop timer when the child exits normally", async () => {
    vi.useFakeTimers();
    const child = managedChild(Promise.resolve({ code: 0, signal: null }));
    const signalTree = vi.fn().mockResolvedValue(undefined);

    await stopChild(child, { timeoutMs: 5_000, signalTree });

    expect(signalTree).toHaveBeenCalledWith(child, "SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("escalates to SIGKILL after the graceful timeout", async () => {
    vi.useFakeTimers();
    const result = deferred<{ code: number | null; signal: NodeJS.Signals | null }>();
    const child = managedChild(result.promise);
    const signalTree = vi.fn(async (_child: ManagedChild, signal: "SIGTERM" | "SIGKILL") => {
      if (signal === "SIGKILL") result.resolve({ code: null, signal: "SIGKILL" });
    });

    const stopping = stopChild(child, { timeoutMs: 25, signalTree });
    await vi.advanceTimersByTimeAsync(25);
    await stopping;

    expect(signalTree.mock.calls.map((call) => call[1])).toEqual(["SIGTERM", "SIGKILL"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a real managed child process", async () => {
    const child = startChild("timer fixture", process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await stopChild(child, { timeoutMs: 1_000 });
      await expect(child.done).resolves.toMatchObject({ signal: "SIGTERM" });
    } finally {
      await stopChild(child, { timeoutMs: 100 });
    }
  });
});

describe("cleanup", () => {
  it("is joinable and attempts every action after a failure", async () => {
    const gate = deferred<void>();
    const second = vi.fn().mockResolvedValue(undefined);
    const cleanup = createCleanup([
      {
        name: "first",
        run: async () => {
          await gate.promise;
          throw new Error("first broke");
        },
      },
      { name: "second", run: second },
    ]);

    const firstCall = cleanup();
    const joinedCall = cleanup();
    expect(joinedCall).toBe(firstCall);
    gate.resolve();

    await expect(firstCall).rejects.toThrow("E2E cleanup failed");
    await expect(joinedCall).rejects.toThrow("E2E cleanup failed");
    expect(second).toHaveBeenCalledOnce();
  });
});

describe("readiness", () => {
  it("aborts a stalled request at the readiness deadline", async () => {
    const neverExits = new Promise<never>(() => {});
    const child = managedChild(neverExits, {
      output: "claude-lens running at http://127.0.0.1:4200",
    });
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }) as typeof fetch;

    await expect(
      waitForReady("http://127.0.0.1:4200", child, {
        timeoutMs: 30,
        retryIntervalMs: 1,
        fetchImpl,
      }),
    ).rejects.toThrow("Timed out waiting");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("surfaces CLI exit while a request is in flight", async () => {
    const result = deferred<{ code: number | null; signal: NodeJS.Signals | null }>();
    const child = managedChild(result.promise, { output: "startup output" });
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    setTimeout(() => result.resolve({ code: 1, signal: null }), 5);

    await expect(
      waitForReady("http://127.0.0.1:4200", child, {
        timeoutMs: 1_000,
        retryIntervalMs: 1,
        fetchImpl,
      }),
    ).rejects.toThrow("CLI exited before readiness (code 1)");
  });

  it("accepts ping plus non-empty fixture metrics on the requested URL", async () => {
    const child = managedChild(new Promise<never>(() => {}), {
      output: "claude-lens running at http://127.0.0.1:4200",
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json([{ points: [{ t: "2026-07-03T00:00:00.000Z", value: 1 }] }]),
      ) as typeof fetch;

    await expect(
      waitForReady("http://127.0.0.1:4200", child, { fetchImpl }),
    ).resolves.toBeUndefined();
  });
});

describe("interrupt handling", () => {
  it("waits for the shared cleanup before exiting with status 130", async () => {
    const host = new EventEmitter();
    const cleanupResult = deferred<void>();
    const cleanup = vi.fn(() => cleanupResult.promise);
    const exit = vi.fn();
    const abort = new AbortController();
    const remove = installInterruptHandlers(cleanup, {
      host: host as unknown as SignalHost,
      abort,
      exit,
    });

    host.emit("SIGTERM");
    expect(cleanup).toHaveBeenCalledOnce();
    expect(abort.signal.aborted).toBe(true);
    expect(exit).not.toHaveBeenCalled();

    cleanupResult.resolve();
    await cleanupResult.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exit).toHaveBeenCalledWith(130);
    remove();
  });
});
