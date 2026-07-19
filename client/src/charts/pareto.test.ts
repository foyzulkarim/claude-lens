import { describe, expect, it } from "vitest";
import type { Distribution } from "../../../shared/metrics-contract.js";
import { buildParetoOption } from "./pareto.js";

function pareto(overrides: Partial<NonNullable<Distribution["pareto"]>> = {}) {
  return {
    curve: [
      { entityPct: 10, cumulativeValuePct: 60 },
      { entityPct: 50, cumulativeValuePct: 90 },
      { entityPct: 100, cumulativeValuePct: 100 },
    ],
    topDecileValuePct: 60,
    ...overrides,
  };
}

describe("buildParetoOption", () => {
  it("maps the curve to [entityPct, cumulativeValuePct] pairs", () => {
    const option = buildParetoOption(pareto());
    const [series] = option.series as { data: [number, number][] }[];
    expect(series.data).toEqual([
      [10, 60],
      [50, 90],
      [100, 100],
    ]);
  });

  it("handles undefined (no pareto computed) without throwing", () => {
    expect(() => buildParetoOption(undefined)).not.toThrow();
    const option = buildParetoOption(undefined);
    const [series] = option.series as { data: unknown[] }[];
    expect(series.data).toEqual([]);
  });

  it("axes are pinned to a 0-100 percentage scale", () => {
    const option = buildParetoOption(pareto());
    expect(option.xAxis).toMatchObject({ min: 0, max: 100 });
    expect(option.yAxis).toMatchObject({ min: 0, max: 100 });
  });
});
