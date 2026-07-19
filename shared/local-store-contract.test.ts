import { describe, expect, it } from "vitest";
import { isValidSavedView, isValidSavedViewInput, isValidTagList } from "./local-store-contract.js";

describe("isValidSavedViewInput", () => {
  it("accepts a valid input", () => {
    expect(isValidSavedViewInput({ name: "My view", path: "/sessions", search: "?range=7d" })).toBe(
      true,
    );
  });

  it("accepts an empty search string (no filters applied)", () => {
    expect(isValidSavedViewInput({ name: "Home", path: "/", search: "" })).toBe(true);
  });

  it("accepts an optional pinned: true (ARCH-explore-page.md A3)", () => {
    expect(isValidSavedViewInput({ name: "x", path: "/explore", search: "", pinned: true })).toBe(
      true,
    );
    expect(isValidSavedViewInput({ name: "x", path: "/explore", search: "", pinned: false })).toBe(
      true,
    );
  });

  it("rejects a non-boolean pinned", () => {
    expect(isValidSavedViewInput({ name: "x", path: "/explore", search: "", pinned: "true" })).toBe(
      false,
    );
    expect(isValidSavedViewInput({ name: "x", path: "/explore", search: "", pinned: 1 })).toBe(
      false,
    );
    expect(isValidSavedViewInput({ name: "x", path: "/explore", search: "", pinned: null })).toBe(
      false,
    );
  });

  it("rejects a missing or empty name", () => {
    expect(isValidSavedViewInput({ path: "/sessions", search: "" })).toBe(false);
    expect(isValidSavedViewInput({ name: "  ", path: "/sessions", search: "" })).toBe(false);
  });

  it("rejects a missing or empty path", () => {
    expect(isValidSavedViewInput({ name: "x", search: "" })).toBe(false);
    expect(isValidSavedViewInput({ name: "x", path: "", search: "" })).toBe(false);
  });

  it("rejects a non-string search", () => {
    expect(isValidSavedViewInput({ name: "x", path: "/", search: null })).toBe(false);
  });

  it("rejects non-object values", () => {
    expect(isValidSavedViewInput(null)).toBe(false);
    expect(isValidSavedViewInput("x")).toBe(false);
    expect(isValidSavedViewInput([])).toBe(false);
  });
});

describe("isValidSavedView", () => {
  const base = {
    id: "abc-123",
    name: "tokens by tool",
    path: "/explore",
    search: "?xp.measure=inputTokens&xp.dim=tool",
    createdAt: "2026-07-20T00:00:00.000Z",
  };

  it("accepts a view without pinned (legacy shape, ARCH-explore-page.md A3)", () => {
    expect(isValidSavedView(base)).toBe(true);
  });

  it("accepts pinned: true", () => {
    expect(isValidSavedView({ ...base, pinned: true })).toBe(true);
  });

  it("rejects a non-boolean pinned", () => {
    expect(isValidSavedView({ ...base, pinned: "true" })).toBe(false);
  });
});

describe("isValidTagList", () => {
  it("accepts an empty array", () => {
    expect(isValidTagList([])).toBe(true);
  });

  it("accepts a list of non-empty strings", () => {
    expect(isValidTagList(["important", "follow-up"])).toBe(true);
  });

  it("rejects a non-array value", () => {
    expect(isValidTagList("important")).toBe(false);
    expect(isValidTagList(null)).toBe(false);
  });

  it("rejects an empty-string tag", () => {
    expect(isValidTagList(["important", ""])).toBe(false);
    expect(isValidTagList(["  "])).toBe(false);
  });

  it("rejects non-string entries", () => {
    expect(isValidTagList(["important", 42])).toBe(false);
  });
});
