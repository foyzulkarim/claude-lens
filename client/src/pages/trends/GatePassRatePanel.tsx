import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildTimeseriesOption } from "../../charts/timeseries.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "../dashboard/useStableNow.js";

export interface GatePassRatePanelProps {
  now?: Date;
}

/**
 * Trends gate pass-rate panel (#P4-12; ARCH-p4-12 §High-Level
 * Structure). Replaces `GatePassRateStub.tsx` with a live weekly-grain
 * `gatePassRate` measure. `null` per bucket (no sessions with a cached
 * summary) renders as an empty point on the chart per the established
 * `series-math.ts` convention — never fabricated as 0.
 *
 * The metric engine today returns `null` for every bucket (T5 flips
 * this — measure is session-level via `gateCache.getSummariesBatch`).
 * The component renders the resolved series without any special-case
 * path so the wiring doesn't change when the measure is de-nulled.
 */
export function GatePassRatePanel({ now: injectedNow }: GatePassRatePanelProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["gatePassRate"],
      dimensions: ["time"],
      grain: "week",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const option = useMemo(() => {
    const series = data ?? [];
    // "area" family with `unit: "calls"` (the existing timeseries bridge's
    // axis) — the engine returns gatePassRate as a [0,1] fraction like
    // cacheHitPct; the chart label alone ("Gate pass rate per week") is
    // sufficient for the user to interpret the values without inventing a
    // new chart `Unit`. Same convention `RollingEfficiencyPanel.tsx` uses
    // for `cacheHitPct` (the closest analog measure).
    return buildTimeseriesOption(series, { family: "area", unit: "calls" });
  }, [data]);

  return (
    <section
      data-testid="gate-pass-rate-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        Gate pass rate per week{" "}
        <span className="text-xs font-normal text-slate-500 dark:text-[#8A96A5]">habits</span>
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
        <Chart option={option} className="mt-4 h-56 w-full" ariaLabel="Gate pass rate per week" />
      )}
    </section>
  );
}
