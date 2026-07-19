import { describe, expect, it } from "vitest";
import { K2_SPIKE_THRESHOLD } from "../cache/classifier.js";
import type { AppConfig } from "../../shared/settings-contract.js";
import { DEFAULT_GATE_THRESHOLDS, getGateThresholds } from "./thresholds.js";

describe("getGateThresholds — malformed override clamping (review M1)", () => {
  it("returns defaults when config has no gateThresholds field", () => {
    const result = getGateThresholds({} as AppConfig);
    expect(result).toEqual(DEFAULT_GATE_THRESHOLDS);
  });

  it("returns defaults when gateThresholds is empty", () => {
    const result = getGateThresholds({ gateThresholds: {} });
    expect(result).toEqual(DEFAULT_GATE_THRESHOLDS);
  });

  it("applies valid overrides", () => {
    const result = getGateThresholds({
      gateThresholds: { v2Repeat: 5, c3MaxChars: 20_000 },
    });
    expect(result.v2Repeat).toBe(5);
    expect(result.c3MaxChars).toBe(20_000);
    // Untouched fields keep their defaults.
    expect(result.k2Spike).toBe(DEFAULT_GATE_THRESHOLDS.k2Spike);
  });

  it("clamps a hand-edited negative v2Repeat back to the default", () => {
    const result = getGateThresholds({ gateThresholds: { v2Repeat: -1 } });
    // Without the clamp, V2 would fire on every failure (slot.count < -1 is
    // never true). Returning the default keeps the gate behavior stable.
    expect(result.v2Repeat).toBe(DEFAULT_GATE_THRESHOLDS.v2Repeat);
  });

  it("clamps negative overrides for every threshold field", () => {
    const result = getGateThresholds({
      gateThresholds: {
        v2Repeat: -1,
        c3MaxChars: -100,
        k2Spike: -50,
        e2MaxChars: -1,
        e2MaxLines: -1,
      },
    });
    expect(result.v2Repeat).toBe(DEFAULT_GATE_THRESHOLDS.v2Repeat);
    expect(result.c3MaxChars).toBe(DEFAULT_GATE_THRESHOLDS.c3MaxChars);
    expect(result.k2Spike).toBe(DEFAULT_GATE_THRESHOLDS.k2Spike);
    expect(result.e2MaxChars).toBe(DEFAULT_GATE_THRESHOLDS.e2MaxChars);
    expect(result.e2MaxLines).toBe(DEFAULT_GATE_THRESHOLDS.e2MaxLines);
  });

  it("coerces fractional values to integers via Math.floor", () => {
    const result = getGateThresholds({ gateThresholds: { v2Repeat: 3.7 } });
    expect(result.v2Repeat).toBe(3);
  });

  it("falls back to default for non-finite / non-numeric values", () => {
    // isValidGateThresholds would reject these on the PUT path, but a
    // hand-edited config can land anything.
    const result = getGateThresholds({
      gateThresholds: { v2Repeat: "three" as unknown as number },
    });
    expect(result.v2Repeat).toBe(DEFAULT_GATE_THRESHOLDS.v2Repeat);
  });
});

describe("DEFAULT_GATE_THRESHOLDS — k2Spike mirrors classifier (review nice-to-have)", () => {
  it("matches K2_SPIKE_THRESHOLD in server/cache/classifier.ts", () => {
    expect(DEFAULT_GATE_THRESHOLDS.k2Spike).toBe(K2_SPIKE_THRESHOLD);
  });
});
