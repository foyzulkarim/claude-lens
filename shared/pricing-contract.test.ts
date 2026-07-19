import { describe, expect, it } from "vitest";
import { isValidPricingTable } from "./pricing-contract.js";

describe("isValidPricingTable", () => {
  it("accepts an empty object", () => {
    expect(isValidPricingTable({})).toBe(true);
  });

  it("accepts a valid single-model rate", () => {
    expect(
      isValidPricingTable({
        "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
      }),
    ).toBe(true);
  });

  it("accepts multiple models", () => {
    expect(
      isValidPricingTable({
        "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
        "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
      }),
    ).toBe(true);
  });

  it("accepts zero rates", () => {
    expect(
      isValidPricingTable({
        free: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
      }),
    ).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(isValidPricingTable(null)).toBe(false);
    expect(isValidPricingTable("hello")).toBe(false);
    expect(isValidPricingTable(42)).toBe(false);
    expect(isValidPricingTable([])).toBe(false);
  });

  it("rejects a rate missing a required field", () => {
    expect(
      isValidPricingTable({
        "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3 },
      }),
    ).toBe(false);
  });

  it("rejects a rate with an unknown field", () => {
    expect(
      isValidPricingTable({
        "claude-sonnet-5": {
          input: 3,
          output: 15,
          cacheRead: 0.3,
          cacheCreate: 3.75,
          mystery: 1,
        },
      }),
    ).toBe(false);
  });

  it("rejects negative or non-finite rates", () => {
    expect(
      isValidPricingTable({
        "claude-sonnet-5": { input: -1, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
      }),
    ).toBe(false);
    expect(
      isValidPricingTable({
        "claude-sonnet-5": {
          input: Number.NaN,
          output: 15,
          cacheRead: 0.3,
          cacheCreate: 3.75,
        },
      }),
    ).toBe(false);
  });

  it("rejects a model value that isn't an object", () => {
    expect(isValidPricingTable({ "claude-sonnet-5": "cheap" })).toBe(false);
    expect(isValidPricingTable({ "claude-sonnet-5": null })).toBe(false);
  });
});
