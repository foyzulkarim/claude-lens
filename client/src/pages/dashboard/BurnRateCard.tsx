import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Start of `now`'s calendar month in UTC — pinned to UTC (not the viewer's
 * local timezone) so month boundaries agree with the metrics engine, which
 * buckets everything in UTC (architecture §8; T10 high-risk callout). */
function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Exclusive end of `now`'s calendar month in UTC (i.e. the first instant of
 * next month) — used only to compute the month's day count. */
function utcMonthEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function daysInUtcMonth(now: Date): number {
  return (utcMonthEnd(now).getTime() - utcMonthStart(now).getTime()) / DAY_MS;
}

function elapsedUtcDays(now: Date): number {
  return (now.getTime() - utcMonthStart(now).getTime()) / DAY_MS;
}

function sumSeriesValues(series: Series[]): number {
  return series.reduce(
    (total, s) =>
      total +
      s.points.reduce(
        (seriesTotal, point) =>
          typeof point.value === "number" && Number.isFinite(point.value)
            ? seriesTotal + point.value
            : seriesTotal,
        0,
      ),
    0,
  );
}

export interface BurnRateCardProps {
  /**
   * Monthly budget in USD. No Settings-backed budget config exists yet
   * (#P4-10) — the app itself never passes this, so the card always shows
   * the honest "no budget set" state today. Exposed as a prop so stories
   * (and the future Settings wiring) can exercise the configured state
   * without inventing a fake persisted value here.
   */
  budget?: number;
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

/**
 * Calendar-month-to-date burn rate with a linear projection to month-end
 * (ARCH-dashboard-page.md T10). Overrides only the global date range with
 * the current UTC month — categorical chip filters (project/model/branch/
 * host) stay active (decision A7).
 */
export function BurnRateCard({ budget, now: injectedNow }: BurnRateCardProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // A default parameter (`now = new Date()`) creates a new object on every
  // query-driven render, which would churn the query key and refetch forever.
  // useStableNow keeps `now` stable across renders but still ticks on its own
  // cadence, so month/window boundaries roll forward without a page reload.
  const now = useStableNow(injectedNow);

  const monthStart = useMemo(() => utcMonthStart(now), [now]);
  const daysInMonth = useMemo(() => daysInUtcMonth(now), [now]);
  const elapsedDays = useMemo(() => elapsedUtcDays(now), [now]);

  // Only the categorical `filters` fragment is used — `range` is discarded
  // in favor of this section's own MTD window (decision A7).
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: [],
      grain: "hour",
      range: { from: monthStart.toISOString(), to: now.toISOString() },
      filters: filtersToQuery(filters, now).filters,
    }),
    [monthStart, now, filtersKey],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const mtd = useMemo(() => (data ? sumSeriesValues(data) : undefined), [data]);
  const projected = useMemo(() => {
    if (mtd === undefined) return undefined;
    if (elapsedDays <= 0) return mtd;
    // Linear projection: MTD / elapsedDays * daysInMonth (T10 verification
    // checklist formula).
    return (mtd / elapsedDays) * daysInMonth;
  }, [mtd, elapsedDays, daysInMonth]);

  const pct = budget && budget > 0 && mtd !== undefined ? Math.min(100, (mtd / budget) * 100) : 0;
  const overBudget = budget !== undefined && mtd !== undefined && mtd > budget;

  return (
    <div
      data-testid="burn-rate-card"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Burn rate (month to date)
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

      {!isPending && !isError && mtd !== undefined && (
        <>
          <div className="mt-3 flex items-baseline gap-4">
            {/* `<output>` (not a bare `<span>`) so `aria-label` has a role
                that supports naming (a11y lint: generic roles reject
                aria-label; `<output>`'s implicit "status" role accepts it) —
                also the semantically correct element for a computed value. */}
            <output
              aria-label={`Month-to-date spend: ${formatUnitValue(mtd, "$")}`}
              className="block"
            >
              <span className="block font-mono text-2xl font-medium text-slate-900 dark:text-[#E8EDF2]">
                {formatUnitValue(mtd, "$")}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
                MTD spend
              </span>
            </output>
            {projected !== undefined && (
              <output
                aria-label={`Projected month-end spend: ${formatUnitValue(projected, "$")}`}
                className="block"
              >
                <span className="block font-mono text-lg text-slate-600 dark:text-[#8A96A5]">
                  {formatUnitValue(projected, "$")}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
                  Projected month-end
                </span>
              </output>
            )}
          </div>

          <div className="mt-4">
            {budget !== undefined ? (
              <div>
                <div
                  role="progressbar"
                  aria-label={`Budget usage: ${formatUnitValue(mtd, "$")} of ${formatUnitValue(budget, "$")} budget`}
                  aria-valuenow={Math.round(Math.min(mtd, budget))}
                  aria-valuemin={0}
                  aria-valuemax={budget}
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-[#0B0F14]"
                >
                  <div
                    className={
                      overBudget
                        ? "h-full rounded-full bg-[#B23A3A] dark:bg-[#E05252]"
                        : "h-full rounded-full bg-[#96631E] dark:bg-[#E8A33D]"
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-[#8A96A5]">
                  {formatUnitValue(mtd, "$")} of {formatUnitValue(budget, "$")} budget
                  {overBudget ? " — over budget" : ""}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded border border-dashed border-slate-300 px-3 py-2 dark:border-[#2A323D]">
                <p className="text-xs text-slate-500 dark:text-[#8B98A9]">No budget set.</p>
                <Link
                  href="/settings"
                  className="text-xs font-medium text-[#96631E] dark:text-[#E8A33D]"
                >
                  Set a budget →
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
