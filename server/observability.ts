import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import type { FastifyBaseLogger } from "fastify";
import type { MetricsQuery, SeriesMetricsQuery } from "../shared/metrics-contract.js";

// ---------------------------------------------------------------------------
// Thresholds (ARCH-119 A3/R5 — the single place these live; no config
// plumbing for the MVP).
// ---------------------------------------------------------------------------

/** `/api/metrics` requests at/above this wall time log at `warn` instead of `info`. */
export const SLOW_QUERY_MS = 250;
/** Sustained event-loop p99 lag at/above this (ms) triggers a `warn`. */
export const EVENT_LOOP_P99_MS = 200;
/** How often the event-loop monitor samples + resets its histogram (ms). */
export const EVENT_LOOP_SAMPLE_MS = 1000;
/** `monitorEventLoopDelay` histogram resolution (ms). */
export const EVENT_LOOP_RESOLUTION_MS = 20;

const MS_PER_DAY = 86_400_000;
const NS_PER_MS = 1_000_000;

// ---------------------------------------------------------------------------
// Per-query probe (ARCH-119 A1) — a write-only carrier the metrics engine
// fills so the route can log/emit a timing breakdown without the engine's
// pure `Series[]` return type changing.
// ---------------------------------------------------------------------------

export interface QueryProbe {
  /** Accumulated `filterAndGroup()` time (compare mode runs it twice). */
  filterGroupMs: number;
  /** Number of dimension groups produced. */
  groupCount: number;
  /** Total enumerated time buckets across the query (accumulates over compare). */
  bucketCount: number;
  /** Accumulated measure×group×bucket compute-loop time. */
  computeMs: number;
}

export function newQueryProbe(): QueryProbe {
  return { filterGroupMs: 0, groupCount: 0, bucketCount: 0, computeMs: 0 };
}

// ---------------------------------------------------------------------------
// Slow-query predicate + log shape + Server-Timing formatting
// ---------------------------------------------------------------------------

export function isSlowQuery(totalMs: number): boolean {
  return totalMs >= SLOW_QUERY_MS;
}

/** Round to 1 decimal, keeping whole numbers integer-clean (`3` not `3.0`). */
function ms(n: number): number {
  return Number(n.toFixed(1));
}

/**
 * The log-safe shape of a metrics query: measures/dimensions/grain, the
 * range span in days, mode, and (series only) compare/smoothing. Filter
 * *dimension keys* are included; filter *values* never are (N2) — the log
 * describes the query's shape, not its data.
 */
export function queryShape(query: MetricsQuery): Record<string, unknown> {
  const mode = query.mode ?? "series";
  const shape: Record<string, unknown> = {
    measures: query.measures,
    dimensions: query.dimensions,
    grain: query.grain,
    rangeDays: Math.round((Date.parse(query.range.to) - Date.parse(query.range.from)) / MS_PER_DAY),
    mode,
  };
  if (query.filters !== undefined) {
    shape.filterDimensions = Object.keys(query.filters);
  }
  if (mode === "series") {
    const series = query as SeriesMetricsQuery;
    if (series.compare !== undefined) shape.compare = series.compare;
    if (series.smoothing !== undefined) shape.smoothing = series.smoothing;
  }
  return shape;
}

/**
 * W3C `Server-Timing` value exposing the engine sub-phases (ARCH-119 A5):
 * `filter;dur=…, compute;dur=…, engine;dur=…` — the same breakdown as the
 * structured log line, rendered natively in the DevTools Network → Timing
 * pane. `engine` is the route-measured total wall time.
 */
export function serverTimingHeader(probe: QueryProbe, totalMs: number): string {
  return [
    `filter;dur=${ms(probe.filterGroupMs)}`,
    `compute;dur=${ms(probe.computeMs)}`,
    `engine;dur=${ms(totalMs)}`,
  ].join(", ");
}

// ---------------------------------------------------------------------------
// Event-loop lag monitor (ARCH-119 A4/R4)
// ---------------------------------------------------------------------------

export interface EventLoopMonitor {
  stop(): void;
}

/**
 * Injection seams for testability (defaults are the real `perf_hooks` +
 * `setInterval`/`clearInterval`). Keeping these injectable is what lets
 * the monitor be unit-pinned without real wall-clock waits; it does not
 * change ARCH decision A4.
 */
export interface EventLoopMonitorDeps {
  createHistogram?: () => IntervalHistogram;
  setIntervalFn?: (cb: () => void, delayMs: number) => NodeJS.Timeout;
  clearIntervalFn?: (timer: NodeJS.Timeout) => void;
}

/**
 * Enable a `monitorEventLoopDelay` histogram and, on an `unref`'d interval,
 * warn whenever p99 lag (since the last sample) meets `EVENT_LOOP_P99_MS`.
 * The warn is inherently retrospective — a *synchronous* starvation stalls
 * this very interval, so the spike is reported once the loop resumes.
 * Best-effort: if the histogram can't be created it logs once and returns a
 * no-op handle, so instrumentation never takes down the process.
 */
export function startEventLoopMonitor(
  log: Pick<FastifyBaseLogger, "warn">,
  deps: EventLoopMonitorDeps = {},
): EventLoopMonitor {
  const createHistogram =
    deps.createHistogram ?? (() => monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS }));
  const setIntervalFn =
    deps.setIntervalFn ??
    ((cb: () => void, delayMs: number): NodeJS.Timeout =>
      setInterval(cb, delayMs) as NodeJS.Timeout);
  const clearIntervalFn =
    deps.clearIntervalFn ?? ((timer: NodeJS.Timeout): void => clearInterval(timer));

  let histogram: IntervalHistogram;
  try {
    histogram = createHistogram();
    histogram.enable();
  } catch (err) {
    log.warn({ err }, "event-loop monitor unavailable — lag will not be reported");
    return { stop() {} };
  }

  const timer = setIntervalFn(() => {
    const p99Ms = histogram.percentile(99) / NS_PER_MS;
    if (p99Ms >= EVENT_LOOP_P99_MS) {
      log.warn({ p99Ms: ms(p99Ms) }, "event-loop lag high");
    }
    histogram.reset();
  }, EVENT_LOOP_SAMPLE_MS);
  // Never keep the process alive for the monitor.
  (timer as { unref?: () => void }).unref?.();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
      try {
        histogram.disable();
      } catch {
        // already disabled — nothing to do
      }
    },
  };
}
