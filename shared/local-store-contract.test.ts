import { describe, expect, it } from "vitest";
import { isValidSavedViewInput, isValidTagList } from "./local-store-contract.js";

describe("isValidSavedViewInput", () => {
  it("accepts a valid input", () => {
    expect(isValidSavedViewInput({ name: "My view", path: "/sessions", search: "?range=7d" })).toBe(
      true,
    );
  });

  it("accepts an empty search string (no filters applied)", () => {
    expect(isValidSavedViewInput({ name: "Home", path: "/", search: "" })).toBe(true);
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
