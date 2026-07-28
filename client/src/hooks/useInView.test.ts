// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useInView } from "./useInView.js";

afterEach(() => {
  window.location.hash = "";
});

describe("useInView", () => {
  it("starts out of view when no anchorId is given", () => {
    const { result } = renderHook(() => useInView<HTMLDivElement>({ rootMargin: "200px" }));
    expect(result.current.inView).toBe(false);
  });

  it("starts in view immediately when the current location hash matches the given anchorId (#124 review finding #19)", () => {
    window.location.hash = "#cache-scorecard";
    const { result } = renderHook(() =>
      useInView<HTMLDivElement>({ rootMargin: "200px" }, "cache-scorecard"),
    );
    expect(result.current.inView).toBe(true);
  });

  it("stays out of view when the hash does not match the given anchorId", () => {
    window.location.hash = "#some-other-section";
    const { result } = renderHook(() =>
      useInView<HTMLDivElement>({ rootMargin: "200px" }, "cache-scorecard"),
    );
    expect(result.current.inView).toBe(false);
  });

  it("stays out of view when there is no hash at all, even with an anchorId configured", () => {
    const { result } = renderHook(() =>
      useInView<HTMLDivElement>({ rootMargin: "200px" }, "cache-scorecard"),
    );
    expect(result.current.inView).toBe(false);
  });
});
