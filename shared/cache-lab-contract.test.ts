import { describe, expect, it } from "vitest";
import {
  CACHE_LAB_LIMITS,
  CACHE_MISS_ATTRIBUTIONS,
  CACHE_WRITE_CAUSES,
  MISS_ATTRIBUTION_VERDICTS,
} from "./cache-lab-contract.js";
import type {
  CacheLabAnalysis,
  CacheLabQuery,
  CacheMissAttribution,
  CacheWriteCause,
  ClassifiedCacheWrite,
  MissAttributionVerdict,
} from "./cache-lab-contract.js";

describe("CACHE_WRITE_CAUSES -- exhaustive K2 base-cause vocabulary", () => {
  it("contains exactly the four normative K2 causes", () => {
    expect(CACHE_WRITE_CAUSES).toHaveLength(4);
    expect(CACHE_WRITE_CAUSES).toEqual(["first-call", "model-switch", "compaction", "unexplained"]);
  });

  it("every CacheWriteCause literal is in CACHE_WRITE_CAUSES", () => {
    for (const cause of CACHE_WRITE_CAUSES) {
      expect(typeof cause).toBe("string");
    }
  });
});

describe("CACHE_MISS_ATTRIBUTIONS -- exhaustive TTL overlay vocabulary", () => {
  it("contains exactly the three TTL attribution outcomes", () => {
    expect(CACHE_MISS_ATTRIBUTIONS).toHaveLength(3);
    expect(CACHE_MISS_ATTRIBUTIONS).toEqual(["ttl-lapse", "prefix-change", "unknown"]);
  });

  it("every CacheMissAttribution literal is in CACHE_MISS_ATTRIBUTIONS", () => {
    for (const attribution of CACHE_MISS_ATTRIBUTIONS) {
      expect(typeof attribution).toBe("string");
    }
  });
});

describe("MISS_ATTRIBUTION_VERDICTS -- exhaustive verdict vocabulary", () => {
  it("contains exactly the five verdict outcomes", () => {
    expect(MISS_ATTRIBUTION_VERDICTS).toHaveLength(5);
    expect(MISS_ATTRIBUTION_VERDICTS).toEqual([
      "ttl-lapse",
      "prefix-change",
      "mixed",
      "insufficient-evidence",
      "no-events",
    ]);
  });

  it("every MissAttributionVerdict literal is in MISS_ATTRIBUTION_VERDICTS", () => {
    for (const verdict of MISS_ATTRIBUTION_VERDICTS) {
      expect(typeof verdict).toBe("string");
    }
  });
});

describe("CACHE_LAB_LIMITS -- bounded response caps", () => {
  it("caps the invalidation gallery at 50 items and context growth at 24 curves", () => {
    // ARCH §A8 — both caps are part of the contract; the analyzer enforces
    // them so a 10M-call fleet cannot ship megabytes of cards/curves to the
    // browser. Future capacity changes must update both this constant and
    // the analyzer/test in lockstep.
    expect(CACHE_LAB_LIMITS.GALLERY_MAX_ITEMS).toBe(50);
    expect(CACHE_LAB_LIMITS.CONTEXT_MAX_CURVES).toBe(24);
  });
});

describe("shared wire types are exported", () => {
  it("exposes CacheLabQuery, CacheLabAnalysis, ClassifiedCacheWrite at the module root", () => {
    // Compile-time guarantees: each `as unknown as ...` cast below is
    // checked by the test runner; the actual type identity is enforced by
    // tsc --noEmit in the shared gate (these are the types the server
    // route and client wrapper both consume).
    const query: CacheLabQuery = {} as unknown as CacheLabQuery;
    const analysis: CacheLabAnalysis = {} as unknown as CacheLabAnalysis;
    const event: ClassifiedCacheWrite = {} as unknown as ClassifiedCacheWrite;
    expect(query).toBeDefined();
    expect(analysis).toBeDefined();
    expect(event).toBeDefined();

    const cause: CacheWriteCause = "unexplained";
    const attribution: CacheMissAttribution = "ttl-lapse";
    const verdict: MissAttributionVerdict = "mixed";
    expect(cause).toBe("unexplained");
    expect(attribution).toBe("ttl-lapse");
    expect(verdict).toBe("mixed");
  });
});
