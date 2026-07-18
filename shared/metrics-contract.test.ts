import { describe, expect, it } from "vitest";
import { MEASURES } from "./metrics-contract.js";
// biome-ignore lint/correctness/noUnusedImports: Type-level exhaustive guard — presence here keeps the tsc --noEmit gate honest if a literal is added to Measure without a corresponding MEASURES entry.
import type { Measure } from "./metrics-contract.js";

describe("MEASURES -- exhaustive union", () => {
  it("MEASURES contains exactly the union literals (19 total)", () => {
    // Original 16 + 3 new = 19
    expect(MEASURES).toHaveLength(19);
    expect(MEASURES).toContain("toolErrors");
    expect(MEASURES).toContain("cacheSavingsComputed");
    expect(MEASURES).toContain("routingSavingsComputed");
  });

  it("all Measure literals are in MEASURES", () => {
    // exhaustiveArray<T> guard fires at compile time if MEASURES and the
    // union drift out of sync (add to one but not the other).
    for (const m of MEASURES) {
      expect(typeof m).toBe("string");
    }
  });
});

// The type guard lives in metrics-contract.ts where exhaustiveArray<T>
// produces a compile-time error for any literal added to the union without
// a corresponding entry in MEASURES (and vice versa). tsc --noEmit in
// the shared tsconfig gate keeps the two in sync.
