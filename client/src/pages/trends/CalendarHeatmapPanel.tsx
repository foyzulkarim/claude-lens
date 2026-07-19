import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { buildCalendarHeatmapOption } from "../../charts/calendar.js";
import { Chart } from "../../charts/Chart.js";
import { sessionsHrefForBucket } from "../../charts/drilldown.js";
import { UNIT_MEASURES } from "../../charts/units.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";

// Calendar unit switcher is pinned to the pages-spec text ("$ or tokens per
// day", §8) — the mockup's third "sessions" button is sample-data-only
// styling, not a binding option (spec wins over mockup for presence).
type CalendarUnit = "$" | "tokens";
const UNITS: CalendarUnit[] = ["$", "tokens"];

export interface CalendarHeatmapPanelProps {
  now?: Date;
}

export function CalendarHeatmapPanel({ now: injectedNow }: CalendarHeatmapPanelProps) {
  const { filters } = useFilters();
  const [, navigate] = useLocation();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);
  const [unit, setUnit] = useState<CalendarUnit>("$");

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: UNIT_MEASURES[unit],
      dimensions: ["time"],
      grain: "day",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, unit, now],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const option = useMemo(
    () => buildCalendarHeatmapOption(data ?? [], { unit, range: query.range }),
    [data, unit, query.range],
  );

  return (
    <section
      data-testid="calendar-heatmap-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Calendar</h2>
        <div className="flex items-center gap-1">
          {UNITS.map((option_) => (
            <button
              key={option_}
              type="button"
              onClick={() => setUnit(option_)}
              aria-pressed={unit === option_}
              className={clsx(TOGGLE_CLASS, unit === option_ && TOGGLE_ACTIVE_CLASS)}
            >
              {option_}
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
          className="mt-4 h-40 w-full"
          ariaLabel={`Calendar heatmap of ${unit === "$" ? "cost" : "tokens"} per day`}
          onPointClick={(params) => {
            const value = params.value;
            const date = Array.isArray(value) ? value[0] : undefined;
            if (typeof date !== "string") return;
            navigate(sessionsHrefForBucket(new Date(date).toISOString(), "day", filters));
          }}
        />
      )}
    </section>
  );
}
