import { describe, expect, it } from "vitest";
import type { Series } from "../../../../shared/metrics-contract.js";
import { DEFAULT_TOP_N, topNWithOther } from "./chart-options.js";

/**
 * Pure-math tests for the top-N + "other" composer. Storybook covers
 * the rendered chart; these pin the invariant the engine's downstream
 * sum relies on: the kept + other stack totals reconcile against the
 * input totals at every bucket.
 */

function point(t: string, value: number | null): { t: string; value: number | null } {
  return { t, value };
}

function series(label: string, points: { t: string; value: number | null }[]): Series {
  return {
    measure: "costComputed",
    dimensionKey: `project:${label}`,
    label,
    points,
    basis: "computed",
  };
}

describe("chart-options — topNWithOther", () => {
  it("returns input unchanged when within the top-N budget", () => {
    const input = [series("a", [point("2026-07-01", 5)]), series("b", [point("2026-07-01", 4)])];
    const output = topNWithOther(input, 8);
    expect(output).toHaveLength(2);
    expect(output[0]?.label).toBe("a");
    expect(output[1]?.label).toBe("b");
  });

  it("caps at topN + 1 and emits an `other` series summing the dropped series", () => {
    // 3 projects: a,b,c. topN=2 → keep the top-2 by bucket value,
    // the rest roll into `other`. At every bucket the totals reconcile.
    const input = [
      series("a", [point("2026-07-01", 10)]),
      series("b", [point("2026-07-01", 5)]),
      series("c", [point("2026-07-01", 1)]),
    ];
    const output = topNWithOther(input, 2);

    expect(output).toHaveLength(3);
    expect(output.map((s) => s.label)).toEqual(["a", "b", "other"]);

    const other = output[2];
    expect(other?.points[0]?.t).toBe("2026-07-01");
    expect(other?.points[0]?.value).toBe(1);
  });

  it("preserves stack integrity at every bucket (kept + other = input total)", () => {
    // 4 projects with sparse buckets: a+b are always in top-2,
    // c+d sum into `other`. At every bucket: 7 + 3 = 10.
    const input = [
      series("a", [point("2026-07-01", 4), point("2026-07-02", 7)]),
      series("b", [point("2026-07-01", 3), point("2026-07-02", 3)]),
      series("c", [point("2026-07-01", 2)]),
      series("d", [point("2026-07-01", 1)]),
    ];
    const output = topNWithOther(input, 2);

    const labels = output.map((s) => s.label);
    // Buckets 07-01 has the most bands (all 4 input project non-null),
    // so the top-N pick is local to that bucket — a, b; c+d sum to 3.
    // Bucket 07-02 only has a and b, both ≤ topN, so nothing drops.
    expect(labels).toEqual(["a", "b", "other"]);

    const other = output[2];
    const day1 = other?.points.find((p) => p.t === "2026-07-01");
    const day2 = other?.points.find((p) => p.t === "2026-07-02");

    // Day 1: kept a+b contribute 7, input total = 4+3+2+1 = 10, "other" = 3.
    expect(day1?.value).toBe(3);
    // Day 2: only a+b contributed (c+d had no 07-02 points), so "other" = 0.
    expect(day2?.value).toBe(0);
  });

  it("respects DEFAULT_TOP_N = 8 as the default argument", () => {
    // 12 projects at a single bucket: top-8 stay, 4 sum into "other".
    const input = Array.from({ length: 12 }, (_, i) =>
      series(`p${i}`, [point("2026-07-01", 12 - i)]),
    );
    const output = topNWithOther(input);

    expect(output).toHaveLength(DEFAULT_TOP_N + 1);
    expect(output.at(-1)?.label).toBe("other");

    // p8..p11 are the dropped 4: 4 + 3 + 2 + 1 = 10 → "other"
    const otherValue = output.at(-1)?.points[0]?.value;
    expect(otherValue).toBe(10);
  });

  it("treats sparse / null points as 0 so totals still reconcile", () => {
    // Project c has no day-2 point. At day-2, only a+b + d landed; d
    // being the smallest at day-1 ranks last, but at day-2 only a and
    // b are non-zero, so even with topN=2 d's absence means the kept
    // set is the full {a, b}.
    const input = [
      series("a", [point("2026-07-01", 9), point("2026-07-02", 1)]),
      series("b", [point("2026-07-01", 1), point("2026-07-02", 1)]),
      series("c", [point("2026-07-01", 0)]),
    ];
    const output = topNWithOther(input, 2);

    // The only time `c` is "kept-worthy" is never; c always drops to
    // "other". Day-1: 9+1+0 = 10, kept = 9+1 = 10, other = 0.
    // Day-2: a+b = 2, no c, no `other`.
    expect(output.at(-1)?.label).toBe("other");
    const day1 = output.at(-1)?.points.find((p) => p.t === "2026-07-01");
    const day2 = output.at(-1)?.points.find((p) => p.t === "2026-07-02");
    expect(day1?.value).toBe(0);
    expect(day2?.value).toBe(0);
  });
});
