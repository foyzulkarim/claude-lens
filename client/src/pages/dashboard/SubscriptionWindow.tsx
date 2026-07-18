import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import type { SessionListParams } from "../../../../shared/sessions-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { listSessions } from "../../api/sessions.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery, serializeFilters, type FilterState } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// T10 scope boundary: "do NOT compute rolling windows server-side; current
// scope derives client-side from hourly series". Per token — the four
// subscription-window inputs are all token measures so the engine returns
// one hourly series per measure and the component sums the matching-hour
// points across measures into a single per-hour cost series.
//
// Architecture A11 + review CQ2/#9 fix: the helper math assumes HOUR-grain
// points covering the matched sessions extent (so peak/reset calculations
// have enough history). The pre-fix query requested `dimensions: []` which
// returns a single aggregate point at range.from — that one point was 30
// days old, so 5h/7d/peak/expiry all resolved to zero. The fix probes
// `/api/sessions` first to obtain `meta.matchedExtent`, then queries all
// four token measures with `dimensions: ["time"]`, hourly grain, over that
// extent. When no sessions match, the metrics request is skipped entirely
// (the engine would 400 on the empty range) and the component renders its
// honest empty state.
interface RollingWindowSpec {
  key: "5h" | "7d";
  label: string;
  durationMs: number;
}

const WINDOWS: RollingWindowSpec[] = [
  { key: "5h", label: "5h", durationMs: 5 * HOUR_MS },
  { key: "7d", label: "7d", durationMs: 7 * DAY_MS },
];

const TOKEN_MEASURES = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreateTokens",
] as const;

interface Point {
  t: number;
  value: number;
}

function toPoints(series: Series[]): Point[] {
  const points: Point[] = [];
  for (const s of series) {
    for (const p of s.points) {
      // Skip null/non-finite points — KEEP real zero values, which carry
      // information (no token activity in that hour).
      if (typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
      points.push({ t: new Date(p.t).getTime(), value: p.value });
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

/** Probes `/api/sessions` with the active categorical filters only (no date
 * range — RecordsStrip-style "ignore the active date range", since the
 * subscription-window tracker is by definition live). The matched-history
 * extent returned by the route is the right input range for the hourly
 * token query that follows. */
function probeParams(filters: FilterState): SessionListParams {
  return {
    sort: "lastAt",
    order: "desc",
    limit: 1,
    project: filters.project.length > 0 ? filters.project : undefined,
    model: filters.model.length > 0 ? filters.model : undefined,
    branch: filters.branch.length > 0 ? filters.branch : undefined,
    host: filters.host.length > 0 ? filters.host : undefined,
  };
}

/**
 * Rolling 5h/7d subscription-window usage tracker (ARCH-dashboard-page.md
 * T10). Overrides only the global date range with its own lookback window —
 * categorical chip filters stay active (decision A7). Rolling-window expiry
 * and historical-peak-vs-ceiling calibration per decision A11.
 *
 * Architecture CQ2/#9: the card derives from one hourly series of summed
 * tokens (the four measures' matching-hour buckets are summed into a single
 * cost-equivalent token series; "token units" is what the helper math was
 * originally written against). Review CQ2 wanted the card in USD — `ceiling`
 * is still labeled in dollars since it's a Settings-configurable spend
 * cap, but the per-row tracker bars are token counts. The visual hierarchy
 * stays the same (current → peak/ceiling → expiry countdown).
 */
export function SubscriptionWindow({ ceiling, now: injectedNow }: SubscriptionWindowProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // Keep `now` stable across query-driven renders (a fresh Date in the
  // parameter default would churn the query key and create a continuous
  // POST /api/metrics loop) while still ticking on its own cadence, so the
  // rolling window and its countdown roll forward without a page reload.
  const now = useStableNow(injectedNow);

  // Step 1: probe `/api/sessions` for the matched-history extent. The
  // hourly token queries below use that as their `range` so the helper math
  // has enough history for the peak search. Categorical filters apply; the
  // active date range is intentionally dropped (we want the live extent).
  // `filtersKey` is included in the query key so a chip-filter change forces
  // a fresh probe (and therefore a fresh matched-extent for the metrics
  // queries below).
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const probe = useMemo(() => probeParams(filters), [filtersKey]);
  const probeQuery = useQuery({
    queryKey: qk.sessions(probe),
    queryFn: ({ signal }) => listSessions(probe, signal),
    placeholderData: keepPreviousData,
  });

  // Step 2: resolve a "to" instant for the metrics query. When the probe
  // returns a matched extent we use its `to` (the latest activity in the
  // filtered set) — falling back to `now` for empty/in-progress stores so
  // a freshly-mounted app still shows live activity.
  const sessionsExtent = probeQuery.data?.meta.matchedExtent ?? null;
  const extentTo = sessionsExtent?.to ?? now.toISOString();
  // Use the categorical filters fragment (without the date range — A7)
  // for the metrics query, exactly like `BurnRateCard`. The metrics
  // query's range itself is overridden below to span from `range.from` (the
  // user's chosen preset) through the matched extent's `to`, so the helper
  // math has enough history for the peak search.
  const { filters: categoricalFilters, range: metricsRange } = filtersToQuery(filters, now);

  const tokenQueries = useQueries({
    queries: TOKEN_MEASURES.map(
      (measure) =>
        ({
          queryKey: qk.metrics({
            measures: [measure],
            dimensions: ["time"],
            grain: "hour",
            range: { from: metricsRange.from, to: extentTo },
            filters: categoricalFilters,
          } as SeriesMetricsQuery),
          queryFn: ({ signal }: { signal: AbortSignal }) =>
            postMetrics(
              {
                measures: [measure],
                dimensions: ["time"],
                grain: "hour",
                range: { from: metricsRange.from, to: extentTo },
                filters: categoricalFilters,
              },
              signal,
            ),
          enabled: !probeQuery.isPending && probeQuery.isSuccess === true,
          placeholderData: keepPreviousData,
        }) as const,
    ),
  });

  const isPending = probeQuery.isPending || tokenQueries.some((q) => q.isPending);
  const isError = probeQuery.isError || tokenQueries.some((q) => q.isError);
  const error = probeQuery.error ?? tokenQueries.find((q) => q.isError)?.error;
  const noMatchedExtent = !probeQuery.isPending && sessionsExtent === null;

  // Merge the four token measures' per-hour points into one cost-equivalent
  // series (sum the four measures' values at every bucket index — engine
  // guarantees aligned bucket boundaries within a single response, A5).
  const allSeries: Series[] = tokenQueries.flatMap((q) => q.data ?? []);
  const points = useMemo(() => (isPending ? [] : toPoints(allSeries)), [allSeries, isPending]);
  const prefix = useMemo(() => buildPrefixSums(points), [points]);
  const extentEnd = new Date(extentTo).getTime();

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
          {error?.message}
        </p>
      )}

      {!isPending && !isError && noMatchedExtent && (
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          No sessions in scope yet — start a Claude session to begin tracking usage.
        </p>
      )}

      {!isPending && !isError && !noMatchedExtent && (
        <div className="mt-3 flex flex-col gap-4">
          {rows.map((row) => {
            // Review #16 (A11Y1): the visible "vs peak/ceiling" footer and the
            // bar fill use `ceilingBasis`, not bare `peak`. The ARIA range
            // metadata must agree with both, or screen-reader output
            // disagrees with the visual calculation basis. Always derive the
            // declared basis from `ceilingBasis` here.
            const basisLabel = ceiling !== undefined ? "Settings ceiling" : "historical peak";
            const basisTokens = ceiling !== undefined ? ceiling : row.peak;
            return (
              <div key={row.key}>
                <output
                  aria-label={`${row.label} window: ${formatUnitValue(row.current, "tokens")} tokens`}
                  className="flex items-baseline justify-between"
                >
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
                    {row.label}
                  </span>
                  <span className="font-mono text-sm text-slate-900 dark:text-[#E8EDF2]">
                    {formatUnitValue(row.current, "tokens")}
                  </span>
                </output>
                <div
                  role="progressbar"
                  aria-label={`${row.label} window usage: ${formatUnitValue(row.current, "tokens")} tokens of ${basisLabel} ${formatUnitValue(basisTokens, "tokens")} tokens`}
                  aria-valuenow={Math.round(row.current)}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(basisTokens, row.current, 1)}
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
                    vs {basisLabel.toLowerCase()}: {formatUnitValue(basisTokens, "tokens")} tokens
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
