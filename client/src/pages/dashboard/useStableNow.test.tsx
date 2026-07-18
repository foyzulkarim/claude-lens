// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStableNow } from "./useStableNow.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("useStableNow", () => {
  it("advances after the real 60-second refresh interval", () => {
    vi.useFakeTimers();
    const initialNow = new Date("2026-07-16T12:00:00.000Z");
    vi.setSystemTime(initialNow);

    const { result } = renderHook(() => useStableNow());
    expect(result.current.toISOString()).toBe(initialNow.toISOString());

    const tickedNow = new Date(initialNow.getTime() + 60_000);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(result.current.toISOString()).toBe(tickedNow.toISOString());
  });

  it("keeps an injected time fixed and disables the interval", () => {
    vi.useFakeTimers();
    const injectedNow = new Date("2026-07-16T12:00:00.000Z");
    const { result } = renderHook(() => useStableNow(injectedNow));

    act(() => {
      vi.setSystemTime(new Date("2026-07-16T13:00:00.000Z"));
      vi.advanceTimersByTime(60 * 60_000);
    });

    expect(result.current).toBe(injectedNow);
  });
});
