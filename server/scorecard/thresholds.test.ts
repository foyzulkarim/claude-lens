import { describe, expect, it } from "vitest";
import { DEFAULT_SCORECARD_THRESHOLDS, getScorecardThresholds } from "./thresholds.js";

describe("getScorecardThresholds", () => {
  it("returns the documented defaults when scorecard thresholds are absent", () => {
    expect(getScorecardThresholds({})).toEqual({
      floorCalls: 10,
      calibrationMinSessions: 20,
      A: 95,
      B: 85,
      C: 70,
      D: 50,
    });
    expect(DEFAULT_SCORECARD_THRESHOLDS).toEqual(getScorecardThresholds({}));
  });

  it("overrides thresholds field-by-field", () => {
    expect(getScorecardThresholds({ scorecardThresholds: { floorCalls: 15 } })).toEqual({
      ...DEFAULT_SCORECARD_THRESHOLDS,
      floorCalls: 15,
    });
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("falls back for an invalid hand-edited count (%s)", (floorCalls) => {
    expect(getScorecardThresholds({ scorecardThresholds: { floorCalls } }).floorCalls).toBe(10);
  });

  it.each([
    -1,
    70.5,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("falls back for an invalid hand-edited band (%s)", (C) => {
    expect(getScorecardThresholds({ scorecardThresholds: { C } }).C).toBe(70);
  });

  it("falls back to the full default band set when resolved bands are out of order", () => {
    expect(getScorecardThresholds({ scorecardThresholds: { A: 80, B: 90, C: 60, D: 40 } })).toEqual(
      {
        ...DEFAULT_SCORECARD_THRESHOLDS,
      },
    );
  });
});
