import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// How far back the historical-peak search looks (T10 scope boundary: "do
// NOT compute rolling windows server-side; current scope derives
// client-side from hourly series"). There's no contract capability to ask
// the engine for a session's full ingested extent, so the peak search is
// bounded to a practical lookback rather than truly "ever" — documented
// here rather than silently assumed.
const PEAK_LOOKBACK_DAYS = 30;

interface RollingWindowSpec {
  key: "5h" | "7d";
  label: string;
  durationMs: number;
}

const WINDOWS: RollingWindowSpec[] = [
  { key: "5h", label: "5h", durationMs: 5 * HOUR_MS },
  { key: "7d", label: "7d", durationMs: 7 * DAY_MS },
];

interface Point {
  t: number;
  value: number;
}

function toPoints(series: Series[]): Point[] {
  const points: Point[] = [];
  for (const s of series) {
    for (const p of s.points) {
      if (typeof p.value === "number" && Number.isFinite(p.value)) {
        points.push({ t: new Date(p.t).getTime(), value: p.value });
      }
    }
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/** First index whose `.t` is >= `target` (standard lower-bound binary
 * search over the ascending-sorted point list). */
function lowerBound(points: Point[], target: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (points[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildPrefixSums(points: Point[]): number[] {
  const prefix = [0];
  for (const p of points) prefix.push(prefix[prefix.length - 1] + p.value);
  return prefix;
}

/** Sum of point values with `t` in `[start, end)`, via prefix sums + binary
 * search — avoids an O(n) scan per window evaluation. */
function sumInRange(points: Point[], prefix: number[], start: number, end: number): number {
  const lo = lowerBound(points, start);
  const hi = lowerBound(points, end);
  return prefix[hi] - prefix[lo];
}

/** The rolling window's total ending exactly at `end`. */
function rollingWindowValue(
  points: Point[],
  prefix: number[],
  durationMs: number,
  end: number,
): number {
  return sumInRange(points, prefix, end - durationMs, end);
}

/** Max rolling-window total seen anywhere in the fetched extent — evaluated
 * at every bucket boundary (the only instants where a window's composition
 * can change) plus `extentEnd` itself. */
function maxRollingWindowValue(
  points: Point[],
  prefix: number[],
  durationMs: number,
  extentEnd: number,
): number {
  if (points.length === 0) return 0;
  const candidateEnds = new Set<number>([extentEnd]);
  for (const p of points) candidateEnds.add(p.t);
  let max = 0;
  for (const end of candidateEnds) {
    if (end > extentEnd) continue;
    const total = rollingWindowValue(points, prefix, durationMs, end);
    if (total > max) max = total;
  }
  return max;
}

/** Age of the oldest point still contributing to the window ending at
 * `end`, or `undefined` if the window has no contributing points. */
function oldestContributorAge(
  points: Point[],
  durationMs: number,
  end: number,
): number | undefined {
  const start = end - durationMs;
  const lo = lowerBound(points, start);
  const hi = lowerBound(points, end);
  if (lo >= hi) return undefined;
  return end - points[lo].t;
}

/** Formats a millisecond duration as "Xh Ym" (T10 verification checklist
 * label format) — used for both the 5h and 7d windows, so the 7d countdown
 * legitimately reads as a large hour count rather than switching units. */
function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export interface SubscriptionWindowProps {
  /**
   * Settings-calibrated ceiling in USD, replacing the computed historical
   * peak as the comparison basis when set. No Settings-backed calibration
   * exists yet (#P4-15) — the app itself never passes this, so the tracker
   * always falls back to the historical peak today. Exposed as a prop so
   * stories (and the future Settings wiring) can exercise the calibrated
   * state without inventing a fake persisted value here.
   */
  ceiling?: number;
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

/**
 * Rolling 5h/7d subscription-window usage tracker (ARCH-dashboard-page.md
 * T10). Overrides only the global date range with its own lookback window —
 * categorical chip filters stay active (decision A7). Rolling-window expiry
 * and historical-peak-vs-ceiling calibration per decision A11.
 */
export function SubscriptionWindow({ ceiling, now: injectedNow }: SubscriptionWindowProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // Keep `now` stable across query-driven renders (a fresh Date in the
  // parameter default would churn the query key and create a continuous
  // POST /api/metrics loop) while still ticking on its own cadence, so the
  // rolling window and its countdown roll forward without a page reload.
  const now = useStableNow(injectedNow);

  const lookbackStart = useMemo(() => new Date(now.getTime() - PEAK_LOOKBACK_DAYS * DAY_MS), [now]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: [],
      grain: "hour",
      range: { from: lookbackStart.toISOString(), to: now.toISOString() },
      filters: filtersToQuery(filters, now).filters,
    }),
    [lookbackStart, now, filtersKey],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const points = useMemo(() => (data ? toPoints(data) : []), [data]);
  const prefix = useMemo(() => buildPrefixSums(points), [points]);
  const extentEnd = now.getTime();

  const rows = useMemo(
    () =>
      WINDOWS.map((w) => {
        const current = rollingWindowValue(points, prefix, w.durationMs, extentEnd);
        const peak = maxRollingWindowValue(points, prefix, w.durationMs, extentEnd);
        const ceilingBasis = ceiling !== undefined ? ceiling : peak;
        const pct =
          ceilingBasis > 0 ? Math.min(100, (current / ceilingBasis) * 100) : current > 0 ? 100 : 0;
        const age = oldestContributorAge(points, w.durationMs, extentEnd);
        const resetsIn = age !== undefined ? formatCountdown(w.durationMs - age) : undefined;
        return { ...w, current, peak, pct, resetsIn };
      }),
    [points, prefix, extentEnd, ceiling],
  );

  return (
    <div
      data-testid="subscription-window"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Subscription window
      </h2>

      {isPending && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading…
        </p>
      )}
      {isError && (
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error.message}
        </p>
      )}

      {!isPending && !isError && (
        <div className="mt-3 flex flex-col gap-4">
          {rows.map((row) => (
            <div key={row.key}>
              {/* `<output>` (not a bare `<div>`) so `aria-label` has a role
                  that supports naming (a11y lint: generic roles reject
                  aria-label; `<output>`'s implicit "status" role accepts
                  it) — also the semantically correct element for a
                  computed value. */}
              <output
                aria-label={`${row.label} window: ${formatUnitValue(row.current, "$")}`}
                className="flex items-baseline justify-between"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
                  {row.label}
                </span>
                <span className="font-mono text-sm text-slate-900 dark:text-[#E8EDF2]">
                  {formatUnitValue(row.current, "$")}
                </span>
              </output>
              <div
                role="progressbar"
                aria-label={`${row.label} window usage: ${formatUnitValue(row.current, "$")} of ${
                  ceiling !== undefined ? "Settings ceiling" : "historical peak"
                } ${formatUnitValue(row.peak, "$")}`}
                aria-valuenow={Math.round(row.current)}
                aria-valuemin={0}
                aria-valuemax={Math.max(row.peak, row.current, 1)}
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#0B0F14]"
              >
                <div
                  className="h-full rounded-full bg-[#0E7A8C] dark:bg-[#4FC3D9]"
                  style={{ width: `${row.pct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-[#8A96A5]">
                <span data-testid={`${row.key}-resets-in`}>
                  {row.resetsIn ? `Resets in ${row.resetsIn}` : "No activity in window"}
                </span>
                <span>
                  vs {ceiling !== undefined ? "ceiling (Settings)" : "peak (computed)"}:{" "}
                  {formatUnitValue(row.peak, "$")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
