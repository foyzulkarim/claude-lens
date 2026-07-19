import clsx from "clsx";
import { useMemo, useState } from "react";
import type { Grain, Measure, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import type { Unit } from "../../charts/units.js";
import { formatUnitValue, UNIT_MEASURES } from "../../charts/units.js";
import { filtersToQuery, type FilterState, serializeFilters } from "../../filters/state.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import {
  buildModelMixAreaOption,
  buildModelMixLinesOption,
  summarizeSeries,
} from "./chart-options.js";

type Shape = "area" | "lines";

const SHAPES: { value: Shape; label: string }[] = [
  { value: "area", label: "stacked area" },
  { value: "lines", label: "lines" },
];

const UNITS: { value: Unit; label: string }[] = [
  { value: "$", label: "$" },
  { value: "tokens", label: "tokens" },
  { value: "calls", label: "calls" },
];

/**
 * Model mix over time (pages spec §6): one stacked-area chart visualizing
 * `measure(model) × time`, with shape (`area` / `lines`) and unit
 * (`$` / `tokens` / `calls`) toggles. Both toggles are local component
 * state — per ARCH A7, display prefs (unit/shape) live in the panel,
 * not the URL.
 *
 * The panel fires one query per active unit (not all three up-front);
 * each toggle swap refetches only the new unit's data, and TanStack's
 * cache retains the prior unit so toggling back is instant. We don't
 * share a query body with the model's stat row (different dimension
 * sets: this is time × model; the stat row is model only), so no
 * dedupe opportunity here yet.
 */
export interface ModelMixOverTimeProps {
  filters: FilterState;
  grain: Grain;
  isPending?: boolean;
}

export function ModelMixOverTime({ filters, grain, isPending }: ModelMixOverTimeProps) {
  const [shape, setShape] = useState<Shape>("area");
  const [unit, setUnit] = useState<Unit>("$");

  const filtersKey = serializeFilters(filters);
  const now = useStableNow();

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(() => {
    const measures: Measure[] = UNIT_MEASURES[unit];
    return {
      measures,
      dimensions: ["time", "model"],
      grain,
      ...filtersToQuery(filters, now),
    };
  }, [filtersKey, unit, grain, now]);

  const {
    data,
    isPending: isQueryPending,
    isError,
    error,
  } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const seriesList = data ?? [];
  const hasBuckets = useMemo(() => seriesList.some((s) => s.points.length > 0), [seriesList]);

  const option = useMemo(() => {
    if (shape === "area") {
      return buildModelMixAreaOption(seriesList, { unit, grain });
    }
    return buildModelMixLinesOption(seriesList, { unit, grain });
  }, [seriesList, shape, unit, grain]);

  const summary = useMemo(() => summarizeSeries(seriesList), [seriesList]);
  const ariaLabel = hasBuckets
    ? `Model mix over time chart; ${seriesList.length} series; total ${formatUnitValue(summary.total, unit)}`
    : "Model mix over time chart";

  const modelCount = seriesList.length;
  const showLoading = (isPending || isQueryPending) && !hasBuckets;

  return (
    <section
      data-testid="model-mix-over-time"
      aria-labelledby="model-mix-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="model-mix-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Model mix over time
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex gap-1" aria-label="Chart shape">
            {SHAPES.map((option_) => (
              <button
                key={option_.value}
                type="button"
                onClick={() => setShape(option_.value)}
                aria-pressed={shape === option_.value}
                className={clsx(TOGGLE_CLASS, shape === option_.value && TOGGLE_ACTIVE_CLASS)}
              >
                {option_.label}
              </button>
            ))}
          </fieldset>
          <fieldset className="flex gap-1" aria-label="Chart unit">
            {UNITS.map((option_) => (
              <button
                key={option_.value}
                type="button"
                onClick={() => setUnit(option_.value)}
                aria-pressed={unit === option_.value}
                className={clsx(TOGGLE_CLASS, unit === option_.value && TOGGLE_ACTIVE_CLASS)}
              >
                {option_.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>

      {hasBuckets && (
        <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-[#8A96A5]">
          {modelCount} model{modelCount === 1 ? "" : "s"} · {summary.buckets} buckets · total{" "}
          {formatUnitValue(summary.total, unit)}
        </p>
      )}

      <div className="relative mt-4">
        {showLoading ? (
          <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
            Loading…
          </p>
        ) : isError ? (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error?.message ?? "Failed to load model mix"}
          </p>
        ) : !hasBuckets ? (
          <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
            No model mix data in this range.
          </p>
        ) : (
          <Chart option={option} className="h-72 w-full" ariaLabel={ariaLabel} />
        )}
      </div>
    </section>
  );
}
