import type { IntervalHistogram } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import type { DistributionMetricsQuery, SeriesMetricsQuery } from "../shared/metrics-contract.js";
import {
  EVENT_LOOP_P99_MS,
  isSlowQuery,
  newQueryProbe,
  type QueryProbe,
  queryShape,
  SLOW_QUERY_MS,
  serverTimingHeader,
  startEventLoopMonitor,
} from "./observability.js";

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

describe("newQueryProbe", () => {
  it("returns a zeroed probe", () => {
    expect(newQueryProbe()).toEqual({
      filterGroupMs: 0,
      groupCount: 0,
      bucketCount: 0,
      computeMs: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Thresholds & slow-query predicate
// ---------------------------------------------------------------------------

describe("isSlowQuery", () => {
  it("is false below the threshold", () => {
    expect(isSlowQuery(SLOW_QUERY_MS - 1)).toBe(false);
  });

  it("is true at and above the threshold boundary", () => {
    expect(isSlowQuery(SLOW_QUERY_MS)).toBe(true);
    expect(isSlowQuery(SLOW_QUERY_MS + 100)).toBe(true);
  });
});

describe("thresholds", () => {
  it("exports the documented constants", () => {
    expect(SLOW_QUERY_MS).toBe(250);
    expect(EVENT_LOOP_P99_MS).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// queryShape (log-safe shape)
// ---------------------------------------------------------------------------

const seriesQuery = (over: Partial<SeriesMetricsQuery> = {}): SeriesMetricsQuery => ({
  measures: ["apiCalls"],
  dimensions: ["time"],
  grain: "day",
  range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
  mode: "series",
  ...over,
});

describe("queryShape", () => {
  it("carries measures/dimensions/grain/rangeDays/mode for a series query", () => {
    const shape = queryShape(seriesQuery());
    expect(shape).toMatchObject({
      measures: ["apiCalls"],
      dimensions: ["time"],
      grain: "day",
      rangeDays: 7,
      mode: "series",
    });
  });

  it("includes compare/smoothing for series, omits them otherwise", () => {
    const withPost = queryShape(seriesQuery({ compare: "previous-period", smoothing: "ma7" }));
    expect(withPost).toMatchObject({ compare: "previous-period", smoothing: "ma7" });

    const dist: DistributionMetricsQuery = {
      measures: ["apiCalls"],
      dimensions: [],
      grain: "day",
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
      mode: "distribution",
      distributionEntity: "session",
    };
    const shape = queryShape(dist);
    expect(shape).not.toHaveProperty("compare");
    expect(shape).not.toHaveProperty("smoothing");
    expect(shape.mode).toBe("distribution");
  });

  it("includes filter dimension keys but never filter values", () => {
    const shape = queryShape(seriesQuery({ filters: { project: ["secret-x"] } }));
    expect(JSON.stringify(shape)).not.toContain("secret-x");
    expect(shape).toMatchObject({ filterDimensions: ["project"] });
  });
});

// ---------------------------------------------------------------------------
// Server-Timing formatting
// ---------------------------------------------------------------------------

describe("serverTimingHeader", () => {
  it("lists filter/compute/engine durations in W3C syntax", () => {
    const probe: QueryProbe = { filterGroupMs: 3, groupCount: 2, bucketCount: 7, computeMs: 7 };
    expect(serverTimingHeader(probe, 11)).toBe("filter;dur=3, compute;dur=7, engine;dur=11");
  });
});

// ---------------------------------------------------------------------------
// Event-loop monitor (injected fake histogram + scheduler)
// ---------------------------------------------------------------------------

function fakeHistogram(p99Ms: number): IntervalHistogram {
  return {
    enable: vi.fn(),
    disable: vi.fn(),
    reset: vi.fn(),
    percentile: (_p: number) => p99Ms * 1_000_000, // ns
  } as unknown as IntervalHistogram;
}

function fakeLog() {
  return { warn: vi.fn() };
}

/** Captures the interval callback so a test can fire a "tick" synchronously. */
function captureScheduler() {
  let tick: (() => void) | null = null;
  const setIntervalFn = vi.fn((cb: () => void) => {
    tick = cb;
    return { unref: vi.fn() } as unknown as NodeJS.Timeout;
  });
  const clearIntervalFn = vi.fn();
  return {
    setIntervalFn,
    clearIntervalFn,
    fire: () => {
      if (!tick) throw new Error("no interval scheduled");
      tick();
    },
  };
}

describe("startEventLoopMonitor", () => {
  it("warns when p99 lag exceeds the threshold", () => {
    const log = fakeLog();
    const histogram = fakeHistogram(EVENT_LOOP_P99_MS + 50);
    const sched = captureScheduler();
    startEventLoopMonitor(log, {
      createHistogram: () => histogram,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    sched.fire();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when p99 lag is under the threshold", () => {
    const log = fakeLog();
    const sched = captureScheduler();
    startEventLoopMonitor(log, {
      createHistogram: () => fakeHistogram(EVENT_LOOP_P99_MS - 50),
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    sched.fire();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("stop() disables the histogram and clears the interval, idempotently", () => {
    const log = fakeLog();
    const histogram = fakeHistogram(0);
    const sched = captureScheduler();
    const monitor = startEventLoopMonitor(log, {
      createHistogram: () => histogram,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    monitor.stop();
    monitor.stop();
    expect(histogram.disable).toHaveBeenCalledTimes(1);
    expect(sched.clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it("no-ops (does not throw) when the histogram cannot be created", () => {
    const log = fakeLog();
    const sched = captureScheduler();
    const monitor = startEventLoopMonitor(log, {
      createHistogram: () => {
        throw new Error("perf_hooks unavailable");
      },
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(() => monitor.stop()).not.toThrow();
    expect(sched.setIntervalFn).not.toHaveBeenCalled();
  });
});
