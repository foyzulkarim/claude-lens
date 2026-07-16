import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { addDays, addHours, addMonths, addWeeks } from "date-fns";
import type { ECElementEvent } from "echarts/core";
import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Grain, SeriesMetricsQuery } from "../../../shared/metrics-contract.js";
import { postMetrics } from "../api/metrics.js";
import { qk } from "../api/queryKeys.js";
import { filtersToQuery, serializeFilters } from "../filters/state.js";
import { useFilters } from "../filters/useFilters.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../ui/toggleStyles.js";
import { Chart } from "./Chart.js";
import { buildTimeseriesOption } from "./timeseries.js";
import { formatUnitValue, UNIT_MEASURES, type Unit } from "./units.js";

type Family = "area" | "bars";

const GRAINS: { value: Grain; label: string }[] = [
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const FAMILIES: Family[] = ["area", "bars"];
const UNITS: Unit[] = ["$", "tokens", "calls"];

function isGrain(value: string): value is Grain {
  return GRAINS.some((g) => g.value === value);
}

interface ToggleGroupProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}

/** Shared button-group rendering for the unit/family controls — same toggle
 * look as `FilterBar.tsx`'s preset buttons, collapsed into one reusable piece
 * here since `ChartCard` is the foundation later chart cards copy from. */
function ToggleGroup<T extends string>({ options, value, onChange }: ToggleGroupProps<T>) {
  return (
    <div className="flex items-center gap-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={clsx(TOGGLE_CLASS, value === option && TOGGLE_ACTIVE_CLASS)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function bucketEnd(t: string, grain: Grain): string {
  const start = new Date(t);
  switch (grain) {
    case "hour":
      return addHours(start, 1).toISOString();
    case "day":
      return addDays(start, 1).toISOString();
    case "week":
      return addWeeks(start, 1).toISOString();
    case "month":
      return addMonths(start, 1).toISOString();
    default: {
      const unhandled: never = grain;
      throw new Error(`unhandled grain: ${unhandled}`);
    }
  }
}

export interface ChartCardProps {
  title: string;
  defaultUnit: Unit;
}

/**
 * Smart chart container (ARCH-chart-layer-live-chart.md T3): owns per-chart
 * control state, derives a `SeriesMetricsQuery` from those controls plus the
 * existing global URL filters, fetches via the existing TanStack Query
 * wiring (which the WS invalidation bus already targets), and renders the
 * toolbar + `<Chart>`. Controls are local `useState`, not URL state
 * (decision A4) — per-widget display prefs, not shareable filter state.
 */
export function ChartCard({ title, defaultUnit }: ChartCardProps) {
  const { filters } = useFilters();
  const [, navigate] = useLocation();
  const filtersKey = serializeFilters(filters);

  const [unit, setUnit] = useState<Unit>(defaultUnit);
  const [family, setFamily] = useState<Family>("area");
  const [grain, setGrain] = useState<Grain>("day");
  const [compare, setCompare] = useState(false);
  const [smoothing, setSmoothing] = useState(false);

  // Memoized on filtersKey + the query-affecting control primitives — never
  // on a fresh object — so unrelated re-renders (e.g. `family`, which only
  // changes the rendered option, not the fetched data) don't change the
  // query's identity and trigger a spurious refetch (same pitfall
  // Dashboard.tsx's previous inline logic documented; ARCH-react-shell.md
  // Open Question).
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are [filtersKey, unit, grain, compare, smoothing] — filters is covered by its stable serialized identity (filtersKey); family is intentionally excluded (render-only)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: UNIT_MEASURES[unit],
      dimensions: [],
      grain,
      ...filtersToQuery(filters, new Date()),
      ...(compare ? { compare: "previous-period" as const } : {}),
      ...(smoothing ? { smoothing: "ma7" as const } : {}),
    }),
    [filtersKey, unit, grain, compare, smoothing],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const option = useMemo(
    () => buildTimeseriesOption(data ?? [], { family, unit }),
    [data, family, unit],
  );

  const ariaLabel = useMemo(() => {
    if (!data) return undefined;
    const total = data.reduce(
      (sum, series) =>
        sum +
        series.points.reduce(
          (seriesTotal, point) =>
            typeof point.value === "number" && Number.isFinite(point.value)
              ? seriesTotal + point.value
              : seriesTotal,
          0,
        ),
      0,
    );
    return `${title} chart; ${data.length} series; total ${formatUnitValue(total, unit)}`;
  }, [data, title, unit]);

  // Stable identity so Chart's click-listener effect (keyed on this prop)
  // only re-subscribes when the drill-down target actually changes, not on
  // every render (e.g. the render-only `family` toggle).
  const handlePointClick = useCallback(
    (params: ECElementEvent): void => {
      const value = params.value;
      const t = Array.isArray(value) ? value[0] : undefined;
      if (typeof t !== "string") return;
      const from = t;
      const to = bucketEnd(t, grain);
      navigate(`/sessions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    },
    [grain, navigate],
  );

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup options={UNITS} value={unit} onChange={setUnit} />
          <ToggleGroup options={FAMILIES} value={family} onChange={setFamily} />
          <select
            aria-label="Grain"
            value={grain}
            onChange={(e) => {
              const value = e.target.value;
              if (isGrain(value)) setGrain(value);
            }}
            className={clsx(TOGGLE_CLASS, "border border-slate-200 dark:border-[#232B36]")}
          >
            {GRAINS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCompare((v) => !v)}
            aria-pressed={compare}
            className={clsx(TOGGLE_CLASS, compare && TOGGLE_ACTIVE_CLASS)}
          >
            Compare
          </button>
          <button
            type="button"
            onClick={() => setSmoothing((v) => !v)}
            aria-pressed={smoothing}
            className={clsx(TOGGLE_CLASS, smoothing && TOGGLE_ACTIVE_CLASS)}
          >
            MA7
          </button>
        </div>
      </div>

      <div className="relative mt-4">
        {isPending && <p className="text-sm text-slate-400">Loading…</p>}
        {isError && <p className="text-sm text-red-500">{error.message}</p>}
        {!isPending && (
          <Chart
            option={option}
            onPointClick={handlePointClick}
            className="h-80 w-full"
            ariaLabel={ariaLabel}
          />
        )}
      </div>
    </div>
  );
}
