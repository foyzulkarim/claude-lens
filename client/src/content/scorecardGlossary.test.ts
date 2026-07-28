import { describe, expect, it } from "vitest";
import { WASTE_EVENT_KINDS, type ScorecardBands } from "../../../shared/scorecard-contract.js";
import {
  describeGradeBands,
  KIND_LABEL,
  METRIC_GLOSSARY,
  WASTE_EVENT_KIND_GLOSSARY,
} from "./scorecardGlossary.js";

describe("KIND_LABEL / WASTE_EVENT_KIND_GLOSSARY", () => {
  it.each(WASTE_EVENT_KINDS)("has a label and a non-empty explanation for %s", (kind) => {
    expect(KIND_LABEL[kind].length).toBeGreaterThan(0);
    expect(WASTE_EVENT_KIND_GLOSSARY[kind].length).toBeGreaterThan(0);
  });

  it("marks only prefix-bust and duplicated-warmup as counting against the score", () => {
    expect(WASTE_EVENT_KIND_GLOSSARY["prefix-bust"]).toContain("Counts against");
    expect(WASTE_EVENT_KIND_GLOSSARY["duplicated-warmup"]).toContain("Counts against");
    expect(WASTE_EVENT_KIND_GLOSSARY["idle-expiry"]).toContain("grade-neutral");
    expect(WASTE_EVENT_KIND_GLOSSARY.unattributed).toContain("grade-neutral");
  });
});

describe("METRIC_GLOSSARY", () => {
  it("has a non-empty description for every scorecard metric", () => {
    for (const description of Object.values(METRIC_GLOSSARY)) {
      expect(description.length).toBeGreaterThan(0);
    }
  });
});

describe("describeGradeBands", () => {
  it("reads the session's actual resolved band cutoffs, not a hardcoded default", () => {
    const bands: ScorecardBands = { A: 96, B: 88, C: 72, D: 55, source: "fixed" };
    const description = describeGradeBands(bands);
    expect(description).toContain("A ≥ 96%");
    expect(description).toContain("B ≥ 88%");
    expect(description).toContain("C ≥ 72%");
    expect(description).toContain("D ≥ 55%");
  });

  it("distinguishes calibrated bands from fixed defaults", () => {
    const fixed: ScorecardBands = { A: 95, B: 85, C: 70, D: 50, source: "fixed" };
    const calibrated: ScorecardBands = { A: 97, B: 90, C: 80, D: 60, source: "calibrated" };
    expect(describeGradeBands(fixed)).toContain("fixed default cutoffs");
    expect(describeGradeBands(calibrated)).toContain("calibrated against your fleet");
  });
});
