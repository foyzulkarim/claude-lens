import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import type { Dimension, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildTimeseriesOption } from "../../charts/timeseries.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";

type Breakdown = "project" | "model";
const BREAKDOWNS: Breakdown[] = ["project", "model"];
const BREAKDOWN_DIMENSION: Record<Breakdown, Dimension> = { project: "project", model: "model" };

export interface StackedWeeklyBarsPanelProps {
  now?: Date;
}

/**
 * "Stacked weekly bars by project/model" (pages spec §8) — the section the
 * mockup omits entirely; spec wins over mockup for presence
 * (ARCH-trends-calendar-budget.md). Reuses `buildTimeseriesOption`'s new
 * `stacked` option (ARCH decision) rather than a bespoke bar builder.
 */
export function StackedWeeklyBarsPanel({ now: injectedNow }: StackedWeeklyBarsPanelProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);
  const [breakdown, setBreakdown] = useState<Breakdown>("project");

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: ["time", BREAKDOWN_DIMENSION[breakdown]],
      grain: "week",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, breakdown, now],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const option = useMemo(
    () => buildTimeseriesOption(data ?? [], { family: "bars", unit: "$", stacked: true }),
    [data],
  );

  return (
    <section
      data-testid="stacked-weekly-bars-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Weekly spend by {breakdown}
        </h2>
        <div className="flex items-center gap-1">
          {BREAKDOWNS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBreakdown(b)}
              aria-pressed={breakdown === b}
              className={clsx(TOGGLE_CLASS, breakdown === b && TOGGLE_ACTIVE_CLASS)}
            >
              {b}
            </button>
          ))}
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

      {!isPending && !isError && (
        <Chart
          option={option}
          className="mt-4 h-64 w-full"
          ariaLabel={`Weekly spend stacked by ${breakdown}`}
        />
      )}
    </section>
  );
}
