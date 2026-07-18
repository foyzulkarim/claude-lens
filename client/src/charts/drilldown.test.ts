import { describe, expect, it } from "vitest";
import type { Grain } from "../../../shared/metrics-contract.js";
import type { FilterState } from "../filters/state.js";
import { sessionsHrefForBucket } from "./drilldown.js";

function baseFilters(overrides: Partial<FilterState> = {}): FilterState {
  return {
    range: { preset: "7d" },
    project: [],
    model: [],
    branch: [],
    host: [],
    ...overrides,
  };
}

describe("sessionsHrefForBucket — bucket → Sessions URL", () => {
  const DAY_TS = "2026-07-15T00:00:00.000Z";

  it("day grain: from = to = bucket start (drill to a point)", () => {
    const url = sessionsHrefForBucket(DAY_TS, "day", baseFilters());
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("from")).toBe(DAY_TS);
    expect(params.get("to")).toBe(DAY_TS);
  });

  it("hour grain: spans [from, from + 1h)", () => {
    const url = sessionsHrefForBucket(DAY_TS, "hour", baseFilters());
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("from")).toBe(DAY_TS);
    expect(params.get("to")).toBe("2026-07-15T01:00:00.000Z");
  });

  it("week grain: spans [from, from + 7d)", () => {
    const url = sessionsHrefForBucket(DAY_TS, "week", baseFilters());
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("from")).toBe(DAY_TS);
    expect(params.get("to")).toBe("2026-07-22T00:00:00.000Z");
  });

  it("month grain: spans [from, from + 1 month)", () => {
    const url = sessionsHrefForBucket(DAY_TS, "month", baseFilters());
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("from")).toBe(DAY_TS);
    expect(params.get("to")).toBe("2026-08-15T00:00:00.000Z");
  });

  it("preserves non-empty chip filters in sorted CSV form", () => {
    const url = sessionsHrefForBucket(
      DAY_TS,
      "day",
      baseFilters({ project: ["beta", "alpha"], model: ["opus"] }),
    );
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("project")).toBe("alpha,beta");
    expect(params.get("model")).toBe("opus");
  });

  it("drops empty chip filters rather than emitting empty CSV", () => {
    const url = sessionsHrefForBucket(
      DAY_TS,
      "day",
      baseFilters({ project: [], model: [], branch: [], host: ["h1"] }),
    );
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.has("project")).toBe(false);
    expect(params.has("model")).toBe(false);
    expect(params.has("branch")).toBe(false);
    expect(params.get("host")).toBe("h1");
  });

  it("preserves every chip in canonical order even if input was unsorted", () => {
    // Multiple unsorted values per chip → sorted output. This is the
    // invariant the Dashboard's ChartCard relied on for stable
    // permalinks (a click → reload → same URL round trip).
    const filters = baseFilters({
      project: ["c", "a", "b"],
      model: ["z", "y"],
    });
    const url = sessionsHrefForBucket(DAY_TS, "day", filters);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("project")).toBe("a,b,c");
    expect(params.get("model")).toBe("y,z");
  });

  it("always builds a /sessions path", () => {
    for (const grain of ["hour", "day", "week", "month"] as Grain[]) {
      const url = sessionsHrefForBucket(DAY_TS, grain, baseFilters());
      expect(url.startsWith("/sessions?")).toBe(true);
    }
  });
});
