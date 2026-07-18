import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_WINDOWS, resolveContextWindow } from "./model-metadata.js";

describe("resolveContextWindow — resolver semantics", () => {
  it("known model returns catalog window", () => {
    const result = resolveContextWindow("claude-sonnet-5");
    expect(result).toBe(200_000);
  });

  it("unknown model returns null (strict equality, not 0 or undefined)", () => {
    const result = resolveContextWindow("unknown-model");
    expect(result).toBeNull();
    expect(result).not.toBe(0);
    expect(result).not.toBeUndefined();
  });

  it("empty catalog returns null", () => {
    const result = resolveContextWindow("claude-sonnet-5", {});
    expect(result).toBeNull();
  });

  it("resolver is pure — same input yields same output with no mutation", () => {
    const inputCatalog = { "claude-opus-4-8": 200_000 };
    const first = resolveContextWindow("claude-opus-4-8", inputCatalog);
    const second = resolveContextWindow("claude-opus-4-8", inputCatalog);
    expect(first).toBe(second);
    // Confirm the catalog was not mutated
    expect(Object.keys(inputCatalog)).toHaveLength(1);
    expect(inputCatalog["claude-opus-4-8"]).toBe(200_000);
  });
});

describe("DEFAULT_CONTEXT_WINDOWS — catalog stability", () => {
  it("lists the four known models", () => {
    const keys = Object.keys(DEFAULT_CONTEXT_WINDOWS).sort();
    expect(keys).toEqual([
      "claude-fable-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-8",
      "claude-sonnet-5",
    ]);
  });
});
