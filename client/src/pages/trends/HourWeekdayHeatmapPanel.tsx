import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildHourWeekdayHeatmapOption } from "../../charts/heatmap.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { bucketHourWeekday } from "./hourWeekdayBuckets.js";

export interface HourWeekdayHeatmapPanelProps {
  now?: Date;
}

/**
 * "When do I burn money" panel (pages spec §8) — an hour-grain query bucketed
 * client-side into a 7×24 grid (ARCH-trends-calendar-budget.md A1: pure
 * timestamp math, no new engine `Dimension`).
 */
export function HourWeekdayHeatmapPanel({ now: injectedNow }: HourWeekdayHeatmapPanelProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed"],
      dimensions: ["time"],
      grain: "hour",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const cells = useMemo(() => bucketHourWeekday(data ?? []), [data]);
  const option = useMemo(() => buildHourWeekdayHeatmapOption(cells), [cells]);

  return (
    <section
      data-testid="hour-weekday-heatmap-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        When do I burn money{" "}
        <span className="text-xs font-normal text-slate-500 dark:text-[#8A96A5]">
          hour × weekday
        </span>
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
        <Chart
          option={option}
          className="mt-4 h-48 w-full"
          ariaLabel="Cost by hour of day and weekday"
        />
      )}
    </section>
  );
}
