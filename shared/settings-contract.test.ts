import { describe, expect, it } from "vitest";
import { isValidBudget } from "./settings-contract.js";

describe("isValidBudget", () => {
  it("accepts null (clears the budget)", () => {
    expect(isValidBudget(null)).toBe(true);
  });

  it("accepts a finite positive number", () => {
    expect(isValidBudget(300)).toBe(true);
    expect(isValidBudget(0.01)).toBe(true);
  });

  it("rejects zero and negative numbers", () => {
    expect(isValidBudget(0)).toBe(false);
    expect(isValidBudget(-50)).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidBudget(Number.NaN)).toBe(false);
    expect(isValidBudget(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("rejects non-number, non-null values", () => {
    expect(isValidBudget(undefined)).toBe(false);
    expect(isValidBudget("300")).toBe(false);
    expect(isValidBudget({})).toBe(false);
  });
});
