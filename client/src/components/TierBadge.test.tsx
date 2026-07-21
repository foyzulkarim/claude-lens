import { describe, expect, it } from "vitest";
import type { TierFlags } from "../../../shared/types.js";
import { costTierLevel } from "./TierBadge.js";
import {
  formatCostBasis,
  formatLineDelta,
  isPremiumUnavailable,
} from "../pages/session-detail/format.js";

// M20 (review): client-side tier predicates. The server-side counterpart
// (derive-session.test.ts) is covered, but the client tier mappers feed
// every badge and "premium unavailable" banner on the Session Detail
// page — pure helpers that flip the entire visual state, so they deserve
// their own unit tests.

const flag = (overrides: Partial<TierFlags> = {}): TierFlags => ({
  hasCostSamples: false,
  hasTurnBoundaries: false,
  hasCostLog: false,
  costBasis: "computed",
  ...overrides,
});

describe("costTierLevel (M20 — client tier predicate)", () => {
  it("returns 'estimated' when costBasis is 'computed'", () => {
    expect(costTierLevel(flag({ costBasis: "computed" }))).toBe("estimated");
  });

  it("returns 'exact' when costBasis is 'observed'", () => {
    expect(costTierLevel(flag({ costBasis: "observed" }))).toBe("exact");
  });

  it("ignores the hasCostSamples / hasCostLog flags (costBasis is the single source of truth)", () => {
    expect(costTierLevel(flag({ hasCostSamples: true, costBasis: "computed" }))).toBe("estimated");
    expect(costTierLevel(flag({ hasCostLog: true, costBasis: "computed" }))).toBe("estimated");
    expect(costTierLevel(flag({ hasCostSamples: false, costBasis: "observed" }))).toBe("exact");
  });
});

describe("formatCostBasis (M20)", () => {
  it("renders '$ observed' for observed", () => {
    expect(
      formatCostBasis({
        costBasis: "observed",
        hasCostSamples: true,
        hasTurnBoundaries: false,
        hasCostLog: false,
      }),
    ).toBe("$ observed");
  });

  it("renders '$ computed' for computed", () => {
    expect(
      formatCostBasis({
        costBasis: "computed",
        hasCostSamples: false,
        hasTurnBoundaries: false,
        hasCostLog: false,
      }),
    ).toBe("$ computed");
  });
});

describe("isPremiumUnavailable (M20)", () => {
  it("returns true when drift is undefined (premium data missing)", () => {
    expect(
      isPremiumUnavailable({
        tier: {
          costBasis: "observed",
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
        },
        drift: undefined,
      }),
    ).toBe(true);
  });

  it("returns false when drift is defined (premium data present)", () => {
    expect(
      isPremiumUnavailable({
        tier: {
          costBasis: "observed",
          hasCostSamples: false,
          hasTurnBoundaries: false,
          hasCostLog: false,
        },
        drift: { delta: 0.5, pct: 12 },
      }),
    ).toBe(false);
  });
});

describe("formatLineDelta (M20 — duplicated in SessionBrowser before M12 fix)", () => {
  it("renders '—' when both are undefined (unavailable)", () => {
    expect(formatLineDelta(undefined, undefined)).toBe("—");
  });

  it("renders '+5/−1' when both present", () => {
    expect(formatLineDelta(5, 1)).toBe("+5/−1");
  });

  it("renders '+5/−0' when only added present", () => {
    expect(formatLineDelta(5, undefined)).toBe("+5/−0");
  });

  it("renders '+0/−3' when only removed present", () => {
    expect(formatLineDelta(undefined, 3)).toBe("+0/−3");
  });

  it("renders '+0/−0' when both are zero (measured, not unavailable)", () => {
    expect(formatLineDelta(0, 0)).toBe("+0/−0");
  });
});
