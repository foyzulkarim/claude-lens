import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import clsx from "clsx";
import { addDays, addHours, addMonths, addWeeks } from "date-fns";
import type { ECElementEvent } from "echarts/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { Grain, Series, SeriesMetricsQuery } from "../../../shared/metrics-contract.js";
import { postMetrics } from "../api/metrics.js";
import { qk } from "../api/queryKeys.js";
import { DataTable } from "../components/DataTable.js";
import {
  type ChipDimension,
  type FilterState,
  filtersToQuery,
  serializeFilters,
} from "../filters/state.js";
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

function bucketEnd(timestamp: string, grain: Grain): string {
  const start = new Date(timestamp);
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

/** Shared by the canvas click handler and the data table's row action so
 * both interaction paths land on the identical filtered Sessions URL.
 * Preserves active categorical filters (project/model/branch/host chips)
 * and replaces the global date range with the clicked bucket's [from, to].
 * Single-day buckets drill to from = to = dayStart. */
function sessionsHrefForBucket(timestamp: string, grain: Grain, filters: FilterState): string {
  const params = new URLSearchParams();

  // Preserve categorical chip filters
  const chipDimensions: ChipDimension[] = ["project", "model", "branch", "host"];
  for (const chip of chipDimensions) {
    if (filters[chip].length > 0) {
      params.set(chip, [...filters[chip]].sort().join(","));
    }
  }

  // Replace date range with the bucket's boundaries
  const from = timestamp;
  // Single-day buckets drill to from = to = dayStart (drill to a point, not
  // a range). For other grains the bucket spans [from, to) where to is the
  // next bucket's start.
  const to = grain === "day" ? from : bucketEnd(timestamp, grain);

  params.set("from", from);
  params.set("to", to);

  return `/sessions?${params.toString()}`;
}

function sumSeriesValues(series: Series[]): number {
  return series.reduce(
    (total, currentSeries) =>
      total +
      currentSeries.points.reduce(
        (seriesTotal, point) =>
          typeof point.value === "number" && Number.isFinite(point.value)
            ? seriesTotal + point.value
            : seriesTotal,
        0,
      ),
    0,
  );
}

export function chartAriaLabel(
  data: Series[] | undefined,
  title: string,
  unit: Unit,
): string | undefined {
  if (!data) return undefined;
  return `${title} chart; ${data.length} series; total ${formatUnitValue(sumSeriesValues(data), unit)}`;
}

export interface BucketRow {
  t: string;
  // Keyed separately from `t` (rather than a shared index signature) so a
  // series literally labeled "t" can never collide with the bucket
  // timestamp, and so a series absent at this bucket is explicitly
  // `undefined` in the type, not silently assumed present (#84 review T1).
  values: Record<string, number | null | undefined>;
}

/** Pivots `Series[]` into one row per bucket timestamp — the non-canvas
 * representation of range/trend/bucket values (issue #84), and the shape
 * `DataTable` renders as the keyboard-operable data table. */
export function bucketRows(data: Series[] | undefined): BucketRow[] {
  if (!data || data.length === 0) return [];
  const byTimestamp = new Map<string, BucketRow>();
  for (const series of data) {
    for (const point of series.points) {
      let row = byTimestamp.get(point.t);
      if (!row) {
        row = { t: point.t, values: {} };
        byTimestamp.set(point.t, row);
      }
      row.values[series.label] = point.value;
    }
  }
  return [...byTimestamp.values()].sort((a, b) => a.t.localeCompare(b.t));
}

function bucketTotal(row: BucketRow): number {
  let total = 0;
  for (const value of Object.values(row.values)) {
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

// UTC-pinned: bucket boundaries are computed server-side in UTC (grain
// math, `bucketEnd` above), so displaying in the viewer's local timezone
// would make a bucket's own label disagree with its own boundaries.
const RANGE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** Visible (not just `aria-label`-only) range text — the first/last bucket
 * timestamps rendered as dates. */
export function chartRangeSummary(data: Series[] | undefined): string | undefined {
  const rows = bucketRows(data);
  if (rows.length === 0) return undefined;
  const first = RANGE_DATE_FORMAT.format(new Date(rows[0].t));
  const last = RANGE_DATE_FORMAT.format(new Date(rows[rows.length - 1].t));
  return first === last ? first : `${first} – ${last}`;
}

/** Visible trend text: compares the bucket-value sum across the first half
 * of the range to the second half. Needs at least two buckets to say anything. */
export function chartTrendSummary(data: Series[] | undefined): string | undefined {
  const rows = bucketRows(data);
  if (rows.length < 2) return undefined;
  const mid = Math.ceil(rows.length / 2);
  const firstHalf = rows.slice(0, mid).reduce((sum, row) => sum + bucketTotal(row), 0);
  const secondHalf = rows.slice(mid).reduce((sum, row) => sum + bucketTotal(row), 0);
  if (firstHalf === 0) return secondHalf === 0 ? "Flat" : "Trending up";
  const pct = Math.round(Math.abs(((secondHalf - firstHalf) / firstHalf) * 100));
  if (pct === 0) return "Flat";
  return secondHalf >= firstHalf ? `Trending up ${pct}%` : `Trending down ${pct}%`;
}

const BUCKET_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const BUCKET_DATETIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

// The hour:minute suffix only carries information at hour grain — a day/
// week/month bucket's own timestamp is always midnight, so showing it there
// is redundant noise in both the visible cell and the row action's
// `aria-label` (#84 review, formatBucketLabel observation).
function formatBucketLabel(timestamp: string, grain: Grain): string {
  const formatter = grain === "hour" ? BUCKET_DATETIME_FORMAT : BUCKET_DATE_FORMAT;
  return formatter.format(new Date(timestamp));
}

const bucketColumnHelper = createColumnHelper<BucketRow>();

/** Timestamp column + one column per series label, rebuilt only when the
 * fetched series set, display unit, or grain changes. */
function buildBucketColumns(
  seriesLabels: string[],
  unit: Unit,
  grain: Grain,
  // biome-ignore lint/suspicious/noExplicitAny: matches DataTable's own ColumnDef<T, any>[] contract (DataTable.tsx)
): ColumnDef<BucketRow, any>[] {
  return [
    bucketColumnHelper.accessor("t", {
      header: "Bucket",
      cell: (info) => formatBucketLabel(info.getValue(), grain),
    }),
    ...seriesLabels.map((label) =>
      bucketColumnHelper.accessor((row) => row.values[label], {
        id: label,
        header: label,
        meta: { align: "right", mono: true },
        cell: (info) => {
          const value = info.getValue();
          return typeof value === "number" ? formatUnitValue(value, unit) : "—";
        },
      }),
    ),
  ];
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
  const [showDataTable, setShowDataTable] = useState(false);
  const [updateAnnouncement, setUpdateAnnouncement] = useState<string>();
  const previousSummary = useRef<string | undefined>(undefined);
  const dataTableId = useId();

  // Memoized on filtersKey + the query-affecting control primitives — never
  // on a fresh object — so unrelated re-renders (e.g. opening the data
  // table) don't change the query's identity and trigger a spurious
  // refetch (same pitfall Dashboard.tsx's previous inline logic
  // documented; ARCH-react-shell.md Open Question). `family` is included
  // because T8 makes it query-affecting: the `dimensions` array depends
  // on it (area requests ["time"], bars sends []), so a family toggle
  // legitimately refetches.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: UNIT_MEASURES[unit],
      dimensions: family === "area" ? ["time"] : [],
      grain,
      ...filtersToQuery(filters, new Date()),
      ...(compare ? { compare: "previous-period" as const } : {}),
      ...(smoothing ? { smoothing: "ma7" as const } : {}),
    }),
    [filtersKey, unit, family, grain, compare, smoothing],
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

  const ariaLabel = useMemo(() => chartAriaLabel(data, title, unit), [data, title, unit]);
  const rangeSummary = useMemo(() => chartRangeSummary(data), [data]);
  const trendSummary = useMemo(() => chartTrendSummary(data), [data]);
  const rows = useMemo(() => bucketRows(data), [data]);
  // Joined into a stable string key (not a fresh array) so `bucketColumns`
  // only rebuilds when the actual label *set* changes, not on every `data`
  // identity change (e.g. a same-labels refetch) — see review finding R1.
  const seriesLabelsKey = (data ?? []).map((s) => s.label).join("|");
  const bucketColumns = useMemo(
    () => buildBucketColumns(seriesLabelsKey ? seriesLabelsKey.split("|") : [], unit, grain),
    [seriesLabelsKey, unit, grain],
  );

  // Includes range/trend, not just the series/total `ariaLabel`, so screen-
  // reader users hear the same range/trend update sighted users see in the
  // visible summary paragraph below (#84 review A2).
  const fullSummary = useMemo(
    () => [ariaLabel, rangeSummary, trendSummary].filter(Boolean).join(" · ") || undefined,
    [ariaLabel, rangeSummary, trendSummary],
  );

  useEffect(() => {
    if (!fullSummary) return;
    if (previousSummary.current && previousSummary.current !== fullSummary) {
      setUpdateAnnouncement(`Chart updated: ${fullSummary}`);
    }
    previousSummary.current = fullSummary;
  }, [fullSummary]);

  // Stable identity so Chart's click-listener effect (keyed on this prop)
  // only re-subscribes when the drill-down target actually changes, not on
  // every render (e.g. the render-only `family` toggle).
  const handlePointClick = useCallback(
    (params: ECElementEvent): void => {
      const value = params.value;
      const timestamp = Array.isArray(value) ? value[0] : undefined;
      if (typeof timestamp !== "string") return;
      navigate(sessionsHrefForBucket(timestamp, grain, filters));
    },
    [grain, navigate, filters],
  );

  // Keyboard-operable twin of `handlePointClick` — reuses the exact same
  // `sessionsHrefForBucket` mapping so a data-table row and its matching
  // canvas point always resolve to the same filtered Sessions URL (#84 A11Y-2).
  const handleRowClick = useCallback(
    (row: BucketRow): void => {
      navigate(sessionsHrefForBucket(row.t, grain, filters));
    },
    [grain, navigate, filters],
  );

  return (
    <div
      data-testid="chart-card"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
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
          <button
            type="button"
            onClick={() => setShowDataTable((v) => !v)}
            aria-expanded={showDataTable}
            aria-controls={dataTableId}
            className={clsx(TOGGLE_CLASS, showDataTable && TOGGLE_ACTIVE_CLASS)}
          >
            Data table
          </button>
        </div>
      </div>

      {(rangeSummary || trendSummary) && (
        <p className="mt-1 text-sm text-slate-600 dark:text-[#8A96A5]">
          {[rangeSummary, trendSummary, rows.length > 0 ? `${rows.length} buckets` : undefined]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      <div className="relative mt-4">
        {isPending && (
          <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
            Loading…
          </p>
        )}
        {isError && (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error.message}
          </p>
        )}
        {updateAnnouncement && (
          <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {updateAnnouncement}
          </p>
        )}
        {!isPending && (
          <Chart
            option={option}
            onPointClick={handlePointClick}
            className="h-80 w-full"
            ariaLabel={ariaLabel}
          />
        )}
      </div>

      {showDataTable && (
        <div id={dataTableId} className="mt-4">
          <DataTable
            data={rows}
            columns={bucketColumns}
            label={`${title} data table`}
            getRowId={(row) => row.t}
            onRowClick={handleRowClick}
            getRowActionLabel={(row) => `View sessions for ${formatBucketLabel(row.t, grain)}`}
          />
        </div>
      )}
    </div>
  );
}
