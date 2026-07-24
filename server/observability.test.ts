import type { IntervalHistogram } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import type {
  DistributionMetricsQuery,
  ScatterMetricsQuery,
  SeriesMetricsQuery,
} from "../shared/metrics-contract.js";
import {
  EVENT_LOOP_P99_MS,
  EVENT_LOOP_SAMPLE_MS,
  isSlowQuery,
  newQueryProbe,
  probeLogFields,
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
      inputMs: 0,
      filterGroupMs: 0,
      scopeMs: 0,
      groupCount: 0,
      bucketCount: 0,
      computeMs: 0,
      engineMs: 0,
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

  // N2's largest surface: `sessionPopulation` carries project/branch/host and
  // raw sessionIds, all transcript-derived. The implementation never reads it
  // — these pin that a future "add distribution detail to the log" change
  // can't quietly start leaking it.
  it("never logs sessionPopulation values for a distribution query", () => {
    const dist: DistributionMetricsQuery = {
      measures: ["apiCalls"],
      dimensions: [],
      grain: "day",
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
      mode: "distribution",
      distributionEntity: "session",
      sessionPopulation: { project: ["secret-project"], sessionId: ["secret-sid"] },
    };
    const serialized = JSON.stringify(queryShape(dist));
    expect(serialized).not.toContain("secret-project");
    expect(serialized).not.toContain("secret-sid");
    expect(serialized).not.toContain("sessionPopulation");
  });

  it("never logs sessionPopulation values for a scatter query", () => {
    const scatter: ScatterMetricsQuery = {
      measures: ["costComputed", "apiCalls"],
      dimensions: [],
      grain: "day",
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-08T00:00:00.000Z" },
      mode: "scatter",
      entity: "session",
      xMeasure: "apiCalls",
      yMeasure: "costComputed",
      sessionPopulation: { project: ["secret-project"], sessionId: ["secret-sid"] },
    };
    const serialized = JSON.stringify(queryShape(scatter));
    expect(serialized).not.toContain("secret-project");
    expect(serialized).not.toContain("secret-sid");
  });

  // Element values are enum-validated upstream, but array *length* is not:
  // an oversized `measures` array would otherwise put ~1MB in one log line.
  it("dedupes and caps oversized measure/dimension lists, recording the real length", () => {
    const shape = queryShape(
      seriesQuery({
        measures: Array(500).fill("apiCalls") as SeriesMetricsQuery["measures"],
        dimensions: ["time"],
      }),
    );
    expect(shape.measures).toEqual(["apiCalls"]); // deduped to one distinct value
    expect(shape.measureCount).toBe(500); // …but the log still says how big it was
    expect(shape).not.toHaveProperty("dimensionCount"); // untouched list: no noise
  });
});

// ---------------------------------------------------------------------------
// Server-Timing formatting
// ---------------------------------------------------------------------------

describe("serverTimingHeader", () => {
  it("lists every phase duration in W3C syntax", () => {
    const probe: QueryProbe = {
      inputMs: 2,
      filterGroupMs: 3,
      scopeMs: 5,
      groupCount: 2,
      bucketCount: 7,
      computeMs: 7,
      engineMs: 15,
    };
    expect(serverTimingHeader(probe, 18)).toBe(
      "input;dur=2, filter;dur=3, scope;dur=5, compute;dur=7, engine;dur=15, total;dur=18",
    );
  });

  // Every real duration is a fractional `performance.now()` delta, so the
  // integer case above exercises `ms()` only in its degenerate form.
  it("rounds fractional durations to one decimal", () => {
    const probe: QueryProbe = {
      inputMs: 0.04,
      filterGroupMs: 3.14159,
      scopeMs: 2.06,
      groupCount: 1,
      bucketCount: 1,
      computeMs: 0.8394580000000114,
      engineMs: 6.0400000001,
    };
    expect(serverTimingHeader(probe, 12.98)).toBe(
      "input;dur=0, filter;dur=3.1, scope;dur=2.1, compute;dur=0.8, engine;dur=6, total;dur=13",
    );
  });
});

describe("probeLogFields", () => {
  it("rounds the same way the header does, so log and header agree", () => {
    const probe: QueryProbe = {
      inputMs: 1.2345,
      filterGroupMs: 3.14159,
      scopeMs: 2.06,
      groupCount: 4,
      bucketCount: 13,
      computeMs: 0.8394580000000114,
      engineMs: 6.04,
    };
    expect(probeLogFields(probe, 12.98)).toEqual({
      inputMs: 1.2,
      filterGroupMs: 3.1,
      scopeMs: 2.1,
      groupCount: 4,
      bucketCount: 13,
      computeMs: 0.8,
      engineMs: 6,
      totalMs: 13,
    });
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
    return { unref: vi.fn() };
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
  it("warns when p99 lag exceeds the threshold, with the measured lag in ms", () => {
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
    // Pins the ns→ms conversion of the *logged* value, not just the compare:
    // logging the raw nanoseconds would otherwise pass.
    expect(log.warn).toHaveBeenCalledWith({ p99Ms: EVENT_LOOP_P99_MS + 50 }, "event-loop lag high");
  });

  // Boundary, mirroring the isSlowQuery boundary test above: `+50`/`-50`
  // alone can't tell `>=` from `>`.
  it("warns at exactly the threshold", () => {
    const log = fakeLog();
    const sched = captureScheduler();
    startEventLoopMonitor(log, {
      createHistogram: () => fakeHistogram(EVENT_LOOP_P99_MS),
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    sched.fire();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  // Without `enable()` the real histogram records nothing and R4 never fires;
  // without the per-tick `reset()` p99 goes cumulative and warns forever after
  // one spike. Both would otherwise pass every other test in this file.
  it("enables the histogram once and resets it after every sample", () => {
    const log = fakeLog();
    const histogram = fakeHistogram(0);
    const sched = captureScheduler();
    startEventLoopMonitor(log, {
      createHistogram: () => histogram,
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    expect(histogram.enable).toHaveBeenCalledTimes(1);
    expect(histogram.reset).not.toHaveBeenCalled();
    sched.fire();
    sched.fire();
    expect(histogram.reset).toHaveBeenCalledTimes(2);
  });

  it("samples on the documented interval", () => {
    const log = fakeLog();
    const sched = captureScheduler();
    startEventLoopMonitor(log, {
      createHistogram: () => fakeHistogram(0),
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    expect(sched.setIntervalFn).toHaveBeenCalledWith(expect.any(Function), EVENT_LOOP_SAMPLE_MS);
  });

  // A throw inside a setInterval callback is an uncaught exception, not a
  // rejection — nothing in the process would catch it. The realistic trigger
  // is `log.warn` after pino's transport worker is gone during shutdown.
  it("survives a throwing log/sample without propagating out of the tick", () => {
    const log = {
      warn: vi.fn(() => {
        throw new Error("transport closed");
      }),
    };
    const sched = captureScheduler();
    startEventLoopMonitor(log, {
      createHistogram: () => fakeHistogram(EVENT_LOOP_P99_MS + 10),
      setIntervalFn: sched.setIntervalFn,
      clearIntervalFn: sched.clearIntervalFn,
    });
    expect(() => sched.fire()).not.toThrow();
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
