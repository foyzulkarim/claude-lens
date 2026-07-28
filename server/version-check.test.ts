import { describe, expect, it, vi } from "vitest";
import { CURRENT_VERSION, isNewerVersion, startVersionChecker } from "./version-check.js";

function fakeLog() {
  return { warn: vi.fn() };
}

/** Captures the interval callback so a test can fire a "tick" synchronously. */
function captureScheduler() {
  let tick: (() => void) | null = null;
  const setIntervalFn = vi.fn((cb: () => void) => {
    tick = cb;
    return { unref: vi.fn() };
  });
  const clearIntervalFn = vi.fn();
  return {
    setIntervalFn,
    clearIntervalFn,
    fire: () => {
      if (!tick) throw new Error("no interval scheduled");
      tick();
    },
  };
}

function okResponse(version: string) {
  return new Response(JSON.stringify({ version }), { status: 200 });
}

describe("isNewerVersion", () => {
  it("is false when versions are equal", () => {
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
  });

  it("is true on a patch bump", () => {
    expect(isNewerVersion("1.2.0", "1.2.1")).toBe(true);
  });

  it("is true on a minor bump", () => {
    expect(isNewerVersion("1.2.0", "1.3.0")).toBe(true);
  });

  it("is true on a major bump", () => {
    expect(isNewerVersion("1.2.0", "2.0.0")).toBe(true);
  });

  it("is false when the running version is ahead of the registry (local dev build)", () => {
    expect(isNewerVersion("1.3.0", "1.2.0")).toBe(false);
  });

  it("treats a missing trailing segment as 0", () => {
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
  });
});

describe("startVersionChecker", () => {
  it("populates the snapshot from a successful registry check", async () => {
    const log = fakeLog();
    const sched = captureScheduler();
    const fetchFn = vi.fn(async () => okResponse("99.0.0"));
    const now = vi.fn(() => 12345);
    const checker = startVersionChecker(log, {
      fetchFn: fetchFn as unknown as typeof fetch,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
      now,
    });
    await vi.waitFor(() => expect(checker.getSnapshot().latestVersion).toBe("99.0.0"));
    expect(checker.getSnapshot()).toEqual({
      currentVersion: CURRENT_VERSION,
      latestVersion: "99.0.0",
      updateAvailable: true,
      lastCheckedAt: 12345,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("registry.npmjs.org"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("leaves the snapshot at defaults when the registry responds non-2xx", async () => {
    const log = fakeLog();
    const sched = captureScheduler();
    const fetchFn = vi.fn(async () => new Response("not found", { status: 404 }));
    const checker = startVersionChecker(log, {
      fetchFn: fetchFn as unknown as typeof fetch,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(checker.getSnapshot()).toEqual({
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      updateAvailable: false,
      lastCheckedAt: null,
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("swallows a rejected fetch and warns once, never throwing", async () => {
    const log = fakeLog();
    const sched = captureScheduler();
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const checker = startVersionChecker(log, {
      fetchFn: fetchFn as unknown as typeof fetch,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledTimes(1));
    expect(checker.getSnapshot()).toEqual({
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      updateAvailable: false,
      lastCheckedAt: null,
    });
  });

  it("re-checks on every interval tick", async () => {
    const log = fakeLog();
    const sched = captureScheduler();
    const fetchFn = vi.fn(async () => okResponse("1.0.1"));
    const checker = startVersionChecker(log, {
      fetchFn: fetchFn as unknown as typeof fetch,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    sched.fire();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(checker.getSnapshot().latestVersion).toBe("1.0.1"));
  });

  it("schedules the interval unref'd so it never keeps the process alive", () => {
    const log = fakeLog();
    const sched = captureScheduler();
    startVersionChecker(log, {
      fetchFn: vi.fn(async () => okResponse("1.0.0")) as unknown as typeof fetch,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    const timer = sched.setIntervalFn.mock.results[0]?.value as { unref: ReturnType<typeof vi.fn> };
    expect(timer.unref).toHaveBeenCalledTimes(1);
  });

  it("stop() clears the interval, idempotently", async () => {
    const log = fakeLog();
    const sched = captureScheduler();
    const fetchFn = vi.fn(async () => okResponse("1.0.0"));
    const checker = startVersionChecker(log, {
      fetchFn: fetchFn as unknown as typeof fetch,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    checker.stop();
    checker.stop();
    expect(sched.clearIntervalFn).toHaveBeenCalledTimes(1);
  });
});
