import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo } from "react";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildTimeseriesOption } from "../../charts/timeseries.js";
import { formatUnitValue } from "../../charts/units.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { buildDistributionQuery, type SessionsPageState } from "./state.js";

// ARCH A3 / A11: distribution runs server-side on the canonical session
// population. The histogram + percentile toggles operate on the SAME
// `Series[]` response (ARCH R6), so no extra fetch is needed when the
// user switches view — the percentile values are always populated.

// The histogram view renders as a single ECharts bar series bucketed by
// costComputed; the percentiles view renders as a stat-table only
// (semantic, non-canvas) so screen-reader users always see the same
// p50/p90/p99 values.

export interface CostDistributionCardProps {
  state: SessionsPageState;
  onStateChange: (patch: Partial<SessionsPageState>) => void;
  /** Optional injection seam for stories / tests. */
  now?: Date;
}

export function CostDistributionCard({
  state,
  onStateChange,
  now: injectedNow,
}: CostDistributionCardProps) {
  const { filters } = useFilters();
  const now = useStableNow(injectedNow);

  const query = useMemo(() => buildDistributionQuery(state, filters, now), [state, filters, now]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const series = data ?? [];
  const seriesWithDist = series.find((s) => s.distribution);
  const dist = seriesWithDist?.distribution;
  const points = seriesWithDist?.points ?? [];

  // Histogram bars derived from the distribution (the server gives us
  // buckets, but we still need an ECharts option for the bar chart).
  const histogramOption = useMemo(() => {
    if (!dist) return null;
    const histSeries = [
      {
        measure: "costComputed" as const,
        dimensionKey: "histogram",
        label: "Sessions",
        points: dist.histogram.map((b) => ({
          t: `${b.rangeStart.toFixed(2)}–${b.rangeEnd.toFixed(2)}`,
          value: b.count,
        })),
      },
    ];
    return buildTimeseriesOption(histSeries, { family: "bars", unit: "$" });
  }, [dist]);

  return (
    <section
      data-testid="cost-distribution-card"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Session cost distribution
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onStateChange({ distributionView: "histogram" })}
            aria-pressed={state.distributionView === "histogram"}
            className={clsx(
              TOGGLE_CLASS,
              state.distributionView === "histogram" && TOGGLE_ACTIVE_CLASS,
            )}
          >
            Histogram
          </button>
          <button
            type="button"
            onClick={() => onStateChange({ distributionView: "percentiles" })}
            aria-pressed={state.distributionView === "percentiles"}
            className={clsx(
              TOGGLE_CLASS,
              state.distributionView === "percentiles" && TOGGLE_ACTIVE_CLASS,
            )}
          >
            Percentiles
          </button>
        </div>
      </div>

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

      {!isPending && state.distributionView === "histogram" && (
        <div className="mt-4">
          {histogramOption ? (
            <Chart
              option={histogramOption}
              className="h-72 w-full"
              ariaLabel={`Cost histogram; ${dist?.histogram.length ?? 0} buckets`}
            />
          ) : (
            <p className="text-sm text-slate-500 dark:text-[#8B98A9]">
              No distribution data in this population.
            </p>
          )}
        </div>
      )}

      {!isPending && state.distributionView === "percentiles" && (
        <div className="mt-4">
          {dist ? (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <PercentileTile label="p50" value={dist.p50} />
              <PercentileTile label="p90" value={dist.p90} />
              <PercentileTile label="p99" value={dist.p99} />
            </dl>
          ) : (
            <p className="text-sm text-slate-500 dark:text-[#8B98A9]">
              No percentile data in this population.
            </p>
          )}
        </div>
      )}

      {/* Always render the semantic summary so screen-reader users hear
          the same numbers sighted users see in either view (ARCH R6). */}
      {dist && !isPending && (
        <>
          <p className="sr-only" aria-live="polite">
            p50 {formatUnitValue(dist.p50 ?? 0, "$")}, p90 {formatUnitValue(dist.p90 ?? 0, "$")},
            p99 {formatUnitValue(dist.p99 ?? 0, "$")}, {points.length} sessions included.
          </p>
          {state.distributionView === "histogram" && (
            <table className="sr-only">
              <caption>Cost histogram buckets</caption>
              <thead>
                <tr>
                  <th scope="col">Cost range</th>
                  <th scope="col">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {dist.histogram.map((bucket) => (
                  <tr key={`${bucket.rangeStart}-${bucket.rangeEnd}`}>
                    <td>
                      {formatUnitValue(bucket.rangeStart, "$")}–
                      {formatUnitValue(bucket.rangeEnd, "$")}
                    </td>
                    <td>{bucket.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function PercentileTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded border border-slate-200 px-3 py-2 dark:border-[#232B36]">
      <dt className="text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-base tabular-nums text-slate-900 dark:text-[#E8EDF2]">
        {value === null || !Number.isFinite(value) ? "—" : formatUnitValue(value, "$")}
      </dd>
    </div>
  );
}
