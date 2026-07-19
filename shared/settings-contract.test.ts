import { describe, expect, it } from "vitest";
import {
  isValidAnomalyFactor,
  isValidBudget,
  isValidGateThresholds,
  isValidScanRoots,
} from "./settings-contract.js";

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

describe("isValidGateThresholds (#P4-11)", () => {
  it("accepts an empty object (means: use all defaults)", () => {
    expect(isValidGateThresholds({})).toBe(true);
  });

  it("accepts a partial object with valid non-negative integers", () => {
    expect(isValidGateThresholds({ v2Repeat: 5 })).toBe(true);
    expect(isValidGateThresholds({ c3MaxChars: 20_000, e2MaxLines: 100 })).toBe(true);
  });

  it("accepts every documented field at once", () => {
    expect(
      isValidGateThresholds({
        v2Repeat: 3,
        c3MaxChars: 15_000,
        k2Spike: 10_000,
        e2MaxChars: 4_000,
        e2MaxLines: 60,
      }),
    ).toBe(true);
  });

  it("accepts zero values (valid non-negative integers)", () => {
    expect(isValidGateThresholds({ v2Repeat: 0 })).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(isValidGateThresholds(null)).toBe(false);
    expect(isValidGateThresholds("hello")).toBe(false);
    expect(isValidGateThresholds(42)).toBe(false);
    expect(isValidGateThresholds([])).toBe(false);
  });

  it("rejects unknown fields (typo protection)", () => {
    expect(isValidGateThresholds({ v2reapeat: 5 })).toBe(false);
    expect(isValidGateThresholds({ v2Repeat: 5, mysteryField: 1 })).toBe(false);
  });

  it("rejects negative numbers", () => {
    expect(isValidGateThresholds({ v2Repeat: -1 })).toBe(false);
  });

  it("rejects non-integer numbers", () => {
    expect(isValidGateThresholds({ v2Repeat: 2.5 })).toBe(false);
    expect(isValidGateThresholds({ c3MaxChars: 15_000.5 })).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidGateThresholds({ v2Repeat: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidGateThresholds({ v2Repeat: Number.NaN })).toBe(false);
  });

  it("rejects non-numeric values for known fields", () => {
    expect(isValidGateThresholds({ v2Repeat: "3" })).toBe(false);
    expect(isValidGateThresholds({ v2Repeat: null })).toBe(false);
  });
});

describe("isValidScanRoots (#P4-15)", () => {
  it("accepts an empty array", () => {
    expect(isValidScanRoots([])).toBe(true);
  });

  it("accepts a root with just a path", () => {
    expect(isValidScanRoots([{ path: "/home/user/.claude/projects" }])).toBe(true);
  });

  it("accepts a root with a path and label", () => {
    expect(isValidScanRoots([{ path: "/x", label: "mac-mini-home" }])).toBe(true);
  });

  it("accepts multiple roots", () => {
    expect(isValidScanRoots([{ path: "/a", label: "a" }, { path: "/b" }])).toBe(true);
  });

  it("rejects non-array values", () => {
    expect(isValidScanRoots({})).toBe(false);
    expect(isValidScanRoots(null)).toBe(false);
    expect(isValidScanRoots("x")).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(isValidScanRoots([{ path: "" }])).toBe(false);
    expect(isValidScanRoots([{ path: "   " }])).toBe(false);
  });

  it("rejects a missing path", () => {
    expect(isValidScanRoots([{ label: "x" }])).toBe(false);
  });

  it("rejects an empty label", () => {
    expect(isValidScanRoots([{ path: "/x", label: "" }])).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(isValidScanRoots([{ path: "/x", mystery: 1 }])).toBe(false);
  });

  it("rejects non-string path/label", () => {
    expect(isValidScanRoots([{ path: 42 }])).toBe(false);
    expect(isValidScanRoots([{ path: "/x", label: 42 }])).toBe(false);
  });
});

describe("isValidAnomalyFactor (#P4-15)", () => {
  it("accepts a positive finite number", () => {
    expect(isValidAnomalyFactor(5)).toBe(true);
    expect(isValidAnomalyFactor(0.5)).toBe(true);
  });

  it("rejects zero and negative numbers", () => {
    expect(isValidAnomalyFactor(0)).toBe(false);
    expect(isValidAnomalyFactor(-3)).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidAnomalyFactor(Number.NaN)).toBe(false);
    expect(isValidAnomalyFactor(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("rejects non-number values", () => {
    expect(isValidAnomalyFactor("5")).toBe(false);
    expect(isValidAnomalyFactor(null)).toBe(false);
    expect(isValidAnomalyFactor(undefined)).toBe(false);
  });
});
