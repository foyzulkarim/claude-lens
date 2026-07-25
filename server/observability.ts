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
  /**
   * Time the route spent materializing the engine's input before calling it:
   * `store.listSessions()`/`listCalls()`/`listTurns()` plus the awaited gate-
   * summary batch. Written by the route, not the engine. Without this phase
   * the slow-query warn is blind to `store.ts`'s stale-session recompute
   * (see its own event-loop caveat), which is exactly the class of stall #119
   * exists to name.
   */
  inputMs: number;
  /** Accumulated `filterAndGroup()` time (compare mode runs it twice). Bucket enumeration is deliberately outside this window. */
  filterGroupMs: number;
  /**
   * Accumulated record-scoping time: `buildCellScopes` in series mode (#118's
   * single pass, `O(C + T×G + S×G)` — driven by record volume × group
   * cardinality, indifferent to bucket count), `indexSessionsByScope` in
   * scatter. Split out from `computeMs` so a slow query says *which* axis
   * grew: records, or buckets.
   */
  scopeMs: number;
  /**
   * Widest group fan-out seen in this query. `Math.max` rather than
   * last-write: `buildGroups` derives groups from the calls inside *that*
   * range, so compare's previous-period run can legitimately produce a
   * different (often smaller, sometimes zero) count than the primary range.
   */
  groupCount: number;
  /** Total enumerated time buckets across the query (accumulates over compare). */
  bucketCount: number;
  /** Accumulated measure×group×bucket read/format-loop time (scoping excluded — see `scopeMs`). */
  computeMs: number;
  /** The `metrics()`/`metricsScatter()` call itself, measured by the route. */
  engineMs: number;
}

export function newQueryProbe(): QueryProbe {
  return {
    inputMs: 0,
    filterGroupMs: 0,
    scopeMs: 0,
    groupCount: 0,
    bucketCount: 0,
    computeMs: 0,
    engineMs: 0,
  };
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
 * Longest list `queryShape` will log. Element *values* are enum-validated by
 * `parseMetricsQuery`, but its array *lengths* are not — a 90k-element
 * `measures` array passes validation and would otherwise put ~1MB in a single
 * log line. Deduping first means a legitimate query never hits the cap
 * (there are far fewer than 20 distinct measures/dimensions), so truncation
 * only ever fires on a pathological body.
 */
const LOG_LIST_CAP = 20;

/** Deduped, capped copy of a logged shape list (never the caller's array). */
function boundedList(values: readonly string[]): string[] {
  const unique = [...new Set(values)];
  return unique.length > LOG_LIST_CAP ? unique.slice(0, LOG_LIST_CAP) : unique;
}

/**
 * The log-safe shape of a metrics query: measures/dimensions/grain, the
 * range span in days, mode, and (series only) compare/smoothing. Filter
 * *dimension keys* are included; filter *values* never are (N2) — the log
 * describes the query's shape, not its data. `sessionPopulation` (project,
 * branch, host, sessionId[] — all transcript-derived) is never read here for
 * the same reason.
 *
 * `measures`/`dimensions` are logged deduped and capped (`LOG_LIST_CAP`);
 * when that shortens the list, `measureCount`/`dimensionCount` carry the
 * original length so the log still says how big the query really was.
 */
export function queryShape(query: MetricsQuery): Record<string, unknown> {
  const mode = query.mode ?? "series";
  const measures = boundedList(query.measures);
  const dimensions = boundedList(query.dimensions);
  const shape: Record<string, unknown> = {
    measures,
    dimensions,
    grain: query.grain,
    rangeDays: Math.round((Date.parse(query.range.to) - Date.parse(query.range.from)) / MS_PER_DAY),
    mode,
  };
  if (measures.length < query.measures.length) shape.measureCount = query.measures.length;
  if (dimensions.length < query.dimensions.length) shape.dimensionCount = query.dimensions.length;
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
 * W3C `Server-Timing` value exposing every measured phase (ARCH-119 A5):
 * `input` (store materialization + gate batch) · `filter` (`filterAndGroup`) ·
 * `scope` (record → cell scoping) · `compute` (the read/format loop) ·
 * `engine` (the whole engine call) · `total` (handler wall time). Rendered
 * natively in the DevTools Network → Timing pane, and the same numbers the
 * structured log line carries.
 */
export function serverTimingHeader(probe: QueryProbe, totalMs: number): string {
  return [
    `input;dur=${ms(probe.inputMs)}`,
    `filter;dur=${ms(probe.filterGroupMs)}`,
    `scope;dur=${ms(probe.scopeMs)}`,
    `compute;dur=${ms(probe.computeMs)}`,
    `engine;dur=${ms(probe.engineMs)}`,
    `total;dur=${ms(totalMs)}`,
  ].join(", ");
}

/**
 * The probe rendered for the log line — same rounding as the header, so a
 * `Server-Timing` value read in DevTools and the log line for that request
 * carry literally the same numbers (raw `performance.now()` deltas otherwise
 * log as `0.8394580000000114` next to a header saying `0.8`).
 */
export function probeLogFields(probe: QueryProbe, totalMs: number): Record<string, number> {
  return {
    inputMs: ms(probe.inputMs),
    filterGroupMs: ms(probe.filterGroupMs),
    scopeMs: ms(probe.scopeMs),
    groupCount: probe.groupCount,
    bucketCount: probe.bucketCount,
    computeMs: ms(probe.computeMs),
    engineMs: ms(probe.engineMs),
    totalMs: ms(totalMs),
  };
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
/**
 * The only thing this module needs from a timer handle. Structural, so the
 * real `setInterval` return value satisfies it with no cast, matching
 * `ingest/poller.ts`'s `ReturnType<typeof setInterval>` convention.
 */
export interface MonitorTimer {
  unref?(): void;
}

export interface EventLoopMonitorDeps {
  createHistogram?: () => IntervalHistogram;
  setIntervalFn?: (cb: () => void, delayMs: number) => MonitorTimer;
  clearIntervalFn?: (timer: MonitorTimer) => void;
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
    ((cb: () => void, delayMs: number): MonitorTimer => setInterval(cb, delayMs));
  const clearIntervalFn =
    deps.clearIntervalFn ??
    ((timer: MonitorTimer): void => clearInterval(timer as ReturnType<typeof setInterval>));

  let histogram: IntervalHistogram;
  try {
    histogram = createHistogram();
    histogram.enable();
  } catch (err) {
    log.warn({ err }, "event-loop monitor unavailable — lag will not be reported");
    return { stop() {} };
  }

  const timer = setIntervalFn(() => {
    // Guarded for the same reason the setup path above is: a throw inside a
    // `setInterval` callback is an *uncaught exception*, not a rejection —
    // no handler in this process would see it. The realistic trigger is
    // `log.warn` itself during teardown, once pino's transport worker is
    // gone; without this, instrumentation would turn a clean shutdown into
    // a crash.
    try {
      const p99Ms = histogram.percentile(99) / NS_PER_MS;
      if (p99Ms >= EVENT_LOOP_P99_MS) {
        log.warn({ p99Ms: ms(p99Ms) }, "event-loop lag high");
      }
      histogram.reset();
    } catch {
      // best-effort — a failed sample must never take down the process
    }
  }, EVENT_LOOP_SAMPLE_MS);
  // Never keep the process alive for the monitor.
  timer.unref?.();

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
