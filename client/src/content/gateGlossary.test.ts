import { describe, expect, it } from "vitest";
import type { GateId, GateThresholds } from "../../../shared/gates-contract.js";
import { GATE_IDS } from "../../../shared/gates-contract.js";
import { describeThreshold, GATE_GLOSSARY } from "./gateGlossary.js";

const THRESHOLDS: GateThresholds = {
  v2Repeat: 3,
  c3MaxChars: 15_000,
  k2Spike: 10_000,
  e2MaxChars: 4_000,
  e2MaxLines: 60,
};

describe("GATE_GLOSSARY", () => {
  it("has an entry for every gate ID, in gates.md prose order", () => {
    expect(Object.keys(GATE_GLOSSARY)).toEqual([...GATE_IDS]);
  });

  it.each(GATE_IDS)("gives %s a non-empty label, whatItChecks, and whyItMatters", (gateId) => {
    const entry = GATE_GLOSSARY[gateId];
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.whatItChecks.length).toBeGreaterThan(0);
    expect(entry.whyItMatters.length).toBeGreaterThan(0);
  });
});

describe("describeThreshold", () => {
  it("returns null for the threshold-free gates", () => {
    for (const gateId of ["V1", "P3", "E1"] as const satisfies GateId[]) {
      expect(describeThreshold(gateId, THRESHOLDS)).toBeNull();
    }
  });

  it("reads the session's actual configured threshold, not a hardcoded default", () => {
    const custom: GateThresholds = { ...THRESHOLDS, v2Repeat: 5 };
    expect(describeThreshold("V2", custom)).toContain("5+");
  });

  it.each([
    "V2",
    "C3",
    "K2",
    "E2",
  ] as const satisfies GateId[])("returns a non-empty sentence for %s", (gateId) => {
    const description = describeThreshold(gateId, THRESHOLDS);
    expect(description).not.toBeNull();
    expect(description?.length).toBeGreaterThan(0);
  });
});
