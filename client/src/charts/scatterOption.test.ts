import { describe, expect, it } from "vitest";
import type { ScatterPoint, ScatterRegression } from "../../../shared/metrics-contract.js";
import { buildScatterOption } from "./scatterOption.js";

describe("buildScatterOption — scatter chart family", () => {
  it("renders points as scatter series data with sessionId", () => {
    const points: ScatterPoint[] = [
      { sessionId: "s1", x: 1, y: 2 },
      { sessionId: "s2", x: 3, y: 4 },
    ];
    const option = buildScatterOption(points, null, {
      xLabel: "Cost",
      yLabel: "Duration",
    });
    expect(option.series).toHaveLength(1);
    const series = option.series[0] as unknown as {
      type: string;
      data: unknown[];
    };
    expect(series.type).toBe("scatter");
    expect(series.data).toHaveLength(2);
  });

  it("adds a regression series when regression is non-null", () => {
    const points: ScatterPoint[] = [
      { sessionId: "s1", x: 0, y: 1 },
      { sessionId: "s2", x: 1, y: 3 },
      { sessionId: "s3", x: 2, y: 5 },
    ];
    const regression: ScatterRegression = { slope: 2, intercept: 1, rSquared: 1 };
    const option = buildScatterOption(points, regression, {
      xLabel: "X",
      yLabel: "Y",
    });
    expect(option.series).toHaveLength(2);
    const regressionSeries = option.series[1] as unknown as {
      name: string;
      data: unknown[];
    };
    expect(regressionSeries.name).toBe("Regression");
    // y = 2x + 1 over x=[0,2] → endpoints (0,1) and (2,5)
    expect(regressionSeries.data).toEqual([
      [0, 1],
      [2, 5],
    ]);
  });

  it("omits the regression series when regression is null", () => {
    const points: ScatterPoint[] = [{ sessionId: "s1", x: 1, y: 1 }];
    const option = buildScatterOption(points, null, {
      xLabel: "X",
      yLabel: "Y",
    });
    expect(option.series).toHaveLength(1);
  });

  it("uses the visible xMin/xMax for the regression line", () => {
    const points: ScatterPoint[] = [
      { sessionId: "s1", x: 100, y: 50 },
      { sessionId: "s2", x: 200, y: 100 },
      { sessionId: "s3", x: 300, y: 150 },
    ];
    // slope=0.5, intercept=0 — y = 0.5x
    const regression: ScatterRegression = { slope: 0.5, intercept: 0, rSquared: 1 };
    const option = buildScatterOption(points, regression, {
      xLabel: "X",
      yLabel: "Y",
    });
    const regressionSeries = option.series[1] as unknown as {
      data: number[][];
    };
    expect(regressionSeries.data).toEqual([
      [100, 50],
      [300, 150],
    ]);
  });

  it("emits axis labels for accessibility", () => {
    const points: ScatterPoint[] = [{ sessionId: "s1", x: 1, y: 1 }];
    const option = buildScatterOption(points, null, {
      xLabel: "Cost ($)",
      yLabel: "Duration (min)",
    });
    expect((option.xAxis as { name: string }).name).toBe("Cost ($)");
    expect((option.yAxis as { name: string }).name).toBe("Duration (min)");
  });
});
