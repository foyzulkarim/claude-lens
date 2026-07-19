import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { pointValueOrNull } from "../../charts/series-math.js";
import { buildTimeseriesOption } from "../../charts/timeseries.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";

type View = "$/day 7d-MA" | "tokens per $" | "cache trend";
const VIEWS: View[] = ["$/day 7d-MA", "tokens per $", "cache trend"];

/**
 * Client-side ratio series: (input + output tokens) / cost per bucket — the
 * "tokens per $" deflator (pages spec §8). No new engine `Measure`
 * (ARCH-trends-calendar-budget.md A1): both inputs already come back from
 * one `measures: [...]` query, this just zips two already-fetched series.
 * A bucket with `cost <= 0` or a missing token/cost value renders `null`
 * (never fabricates a ratio off a zero denominator).
 */
export function tokensPerDollarSeries(cost: Series, input: Series, output: Series): Series {
  const points = cost.points.map((point, i) => {
    const c = pointValueOrNull(point);
    const inTok = pointValueOrNull(input.points[i]);
    const outTok = pointValueOrNull(output.points[i]);
    if (c === null || c <= 0 || inTok === null || outTok === null) {
      return { t: point.t, value: null };
    }
    return { t: point.t, value: (inTok + outTok) / c };
  });
  return {
    measure: "costComputed",
    dimensionKey: cost.dimensionKey,
    label: "Tokens per $",
    points,
  };
}

/**
 * Cache-hit-rate is stored as a 0-1 fraction (`measures.ts`); scaled to a
 * 0-100 number here purely for display so the chart reads like a
 * percentage without widening `charts/units.ts`'s `Unit` union for one
 * sub-view (that union feeds several `never`-exhaustive switches elsewhere).
 */
function scaleToPercent(series: Series): Series {
  return {
    ...series,
    points: series.points.map((p) => ({
      t: p.t,
      value: p.value === null ? null : p.value * 100,
    })),
  };
}

export interface RollingEfficiencyPanelProps {
  now?: Date;
}

export function RollingEfficiencyPanel({ now: injectedNow }: RollingEfficiencyPanelProps) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow(injectedNow);
  const [view, setView] = useState<View>("$/day 7d-MA");

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["costComputed", "cacheHitPct", "inputTokens", "outputTokens"],
      dimensions: ["time"],
      grain: "day",
      smoothing: "ma7",
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
    const cost = series.find((s) => s.measure === "costComputed");
    const cacheHit = series.find((s) => s.measure === "cacheHitPct");
    const input = series.find((s) => s.measure === "inputTokens");
    const output = series.find((s) => s.measure === "outputTokens");

    if (view === "$/day 7d-MA") {
      return buildTimeseriesOption(cost ? [cost] : [], { family: "area", unit: "$" });
    }
    if (view === "tokens per $") {
      if (!cost || !input || !output)
        return buildTimeseriesOption([], { family: "area", unit: "tokens" });
      return buildTimeseriesOption([tokensPerDollarSeries(cost, input, output)], {
        family: "area",
        unit: "tokens",
      });
    }
    return buildTimeseriesOption(cacheHit ? [scaleToPercent(cacheHit)] : [], {
      family: "area",
      unit: "calls",
    });
  }, [data, view]);

  return (
    <section
      data-testid="rolling-efficiency-panel"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
          Rolling efficiency
        </h2>
        <div className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={clsx(TOGGLE_CLASS, view === v && TOGGLE_ACTIVE_CLASS)}
            >
              {v}
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
          className="mt-4 h-56 w-full"
          ariaLabel={`Rolling efficiency: ${view}`}
        />
      )}
    </section>
  );
}
