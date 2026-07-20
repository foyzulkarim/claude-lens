import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import type {
  DistributionMetricsQuery,
  Measure,
  MetricsQuery,
  ScatterMeasure,
  ScatterMetricsQuery,
  ScatterMetricsResult,
  Series,
  SeriesMetricsQuery,
} from "../../../../shared/metrics-contract.js";
import { postMetrics, postScatterMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { Chart } from "../../charts/Chart.js";
import { buildScatterOption } from "../../charts/scatterOption.js";
import { buildTimeseriesOption } from "../../charts/timeseries.js";
import { formatUnitValue, type Unit, unitForMeasure } from "../../charts/units.js";
import { DataTable } from "../../components/DataTable.js";
import type { PivotState } from "./state.js";
import { buildScatterDrillPath, buildSliceDrillSearch } from "./state.js";

/**
 * Result renderer for the Explore page (ARCH-explore-page.md §11).
 * Dispatches on the `mode` discriminator of the supplied `MetricsQuery`:
 *   • scatter        → `postScatterMetrics` + `buildScatterOption`
 *   • distribution   → `postMetrics` (returns `Series[]` with `.distribution`)
 *   • series         → `postMetrics` (returns `Series[]`)
 *
 * The chart-type field in the pivot state is consulted only for visual
 * rendering (bar/line/area/table) — the engine doesn't care about chart
 * type. Scatter is its own branch because its response shape is different
 * (`ScatterMetricsResult`, not `Series[]`).
 */

const MEASURE_LABEL: Record<Measure, string> = {
  costComputed: "Computed $",
  costObserved: "Observed $",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  cacheReadTokens: "Cache read tokens",
  cacheCreateTokens: "Cache write tokens",
  apiCalls: "API calls",
  turns: "Turns",
  sessions: "Sessions",
  toolCalls: "Tool calls",
  cacheHitPct: "Cache hit %",
  wallMinutes: "Wall minutes",
  apiMs: "API latency (ms)",
  linesAdded: "Lines added",
  linesRemoved: "Lines removed",
  gatePassRate: "Gate pass rate",
  toolErrors: "Tool errors",
  cacheSavingsComputed: "Cache savings ($)",
  routingSavingsComputed: "Routing savings ($)",
};

const SCATTER_MEASURE_LABEL: Record<ScatterMeasure, string> = {
  ...MEASURE_LABEL,
  totalTokens: "Total tokens",
};

export interface PivotResultProps {
  query: MetricsQuery;
  state: PivotState;
}

export function PivotResult({ query, state }: PivotResultProps) {
  if (query.mode === "scatter") {
    return <ScatterPivot query={query} state={state} />;
  }
  // Type narrow: query.mode is "series" | "distribution" here, and chart
  // cannot be "scatter" because that branch was handled above (the pivot
  // state's chart type tracks query.mode at the build site).
  const chart: "bar" | "line" | "area" | "table" = state.chart === "scatter" ? "bar" : state.chart;
  // `dim` is the pivot's breakdown dimension; for the default `time`-only
  // path we surface "time" so the drill handler can no-op on a synthetic
  // breakdown (R4: time-bucket drill has no useful Sessions-page meaning).
  const dim: import("../../../../shared/metrics-contract.js").Dimension = state.dim;
  return (
    <SeriesOrDistributionPivot query={query} chart={chart} measure={state.measure} dim={dim} />
  );
}

function SeriesOrDistributionPivot({
  query,
  chart,
  measure,
  dim,
}: {
  query: SeriesMetricsQuery | DistributionMetricsQuery;
  chart: "bar" | "line" | "area" | "table";
  measure: Measure;
  dim: import("../../../../shared/metrics-contract.js").Dimension;
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });
  const [, navigate] = useLocation();
  const search = useSearch();

  if (isPending) return <Skeleton label="Loading pivot…" />;
  if (isError) return <ErrorPanel message={(error as Error).message} />;

  const series = data ?? [];
  const seriesWithDist = series.find((s) => s.distribution);

  const handleSliceClick = (sliceLabel: string) => {
    // Skip the drill for the synthetic `time`-only dim — there's no
    // meaningful "filter by time bucket" semantic on the Sessions page.
    if (dim === "time") return;
    const nextSearch = buildSliceDrillSearch(search, { dim }, sliceLabel);
    navigate(`/sessions?${nextSearch}`);
  };

  return (
    <section
      data-testid="pivot-result"
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        {MEASURE_LABEL[measure]} by {dim}
      </h2>

      {series.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-[#8A96A5]">
          No data for this pivot in the current filter range.
        </p>
      )}

      {series.length > 0 && chart !== "table" && (
        <Chart
          ariaLabel={`${MEASURE_LABEL[measure]} by ${dim} (click a series to drill to Sessions)`}
          className="h-72 w-full"
          option={buildTimeseriesOption(series, {
            family: chart === "bar" ? "bars" : chart === "line" ? "lines" : "area",
            unit: unitForMeasure(measure),
          })}
          onPointClick={(params) => {
            const name = params.name ?? params.seriesName;
            if (typeof name === "string" && name.length > 0) handleSliceClick(name);
          }}
        />
      )}

      {series.length > 0 && chart === "table" && (
        <DataTable
          columns={[
            {
              accessorKey: "label",
              header: dim,
              cell: ({ row }) => (
                <button
                  type="button"
                  data-testid={`drill-slice-${row.original.label}`}
                  onClick={() => handleSliceClick(row.original.label)}
                  className="text-left font-mono text-xs text-slate-900 underline hover:text-slate-700 dark:text-[#E8EDF2] dark:hover:text-[#B6C2D2]"
                >
                  {row.original.label}
                </button>
              ),
            },
            { accessorKey: "value", header: "Value" },
          ]}
          data={tableRows(series)}
        />
      )}

      {query.mode === "distribution" && seriesWithDist?.distribution && (
        <DistributionOverlay
          dist={seriesWithDist.distribution}
          label={seriesWithDist.label}
          unit={unitForMeasure(measure)}
          onSliceClick={handleSliceClick}
          sliceClickable={dim !== "time"}
        />
      )}
    </section>
  );
}

function ScatterPivot({ query, state }: { query: ScatterMetricsQuery; state: PivotState }) {
  const { data, isPending, isError, error } = useQuery<ScatterMetricsResult>({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postScatterMetrics(query, signal),
    placeholderData: keepPreviousData,
  });
  const [, navigate] = useLocation();
  const search = useSearch();

  if (isPending) return <Skeleton label="Loading scatter…" />;
  if (isError) return <ErrorPanel message={(error as Error).message} />;
  if (!data) return null;

  return (
    <section
      data-testid="pivot-result"
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        {SCATTER_MEASURE_LABEL[state.x]} × {SCATTER_MEASURE_LABEL[state.y]}
        {data.sizeMeasure ? ` (size: ${SCATTER_MEASURE_LABEL[data.sizeMeasure]})` : ""}
      </h2>
      <Chart
        ariaLabel={`${state.x} by ${state.y} (click a point to open that session)`}
        className="h-80 w-full"
        option={buildScatterOption(data.points, data.regression, {
          xLabel: SCATTER_MEASURE_LABEL[state.x],
          yLabel: SCATTER_MEASURE_LABEL[state.y],
          hasSize: Boolean(data.sizeMeasure),
        })}
        onPointClick={(params) => {
          const value = params.value;
          if (Array.isArray(value) && typeof value[2] === "string") {
            navigate(buildScatterDrillPath(value[2], search));
          }
        }}
      />
    </section>
  );
}

function DistributionOverlay({
  dist,
  label,
  unit,
  onSliceClick,
  sliceClickable,
}: {
  dist: NonNullable<Series["distribution"]>;
  /** The dimension-value group label this distribution is scoped to
   * (e.g. "main", "claude-lens"). Empty string when the engine returns a
   * single un-grouped distribution. */
  label: string;
  unit: Unit;
  /** Drill handler — navigates to `/sessions?…` filtered to the clicked
   * group label. Only invoked when `sliceClickable` is true. */
  onSliceClick?: (label: string) => void;
  /** `false` when the underlying pivot `dim` is `"time"` (no meaningful
   * session-side semantic for a time-bucket drill). */
  sliceClickable?: boolean;
}) {
  // The engine returns `points: []` for distribution-mode series — the
  // histogram buckets are the only canvas-friendly projection. Reuse the
  // same bar-series shape as the Sessions-page cost distribution card so
  // the two stay visually consistent.
  const histSeries: Series[] = [
    {
      measure: "costComputed",
      dimensionKey: "histogram",
      label: label ? `${label} buckets` : "buckets",
      points: dist.histogram.map((b) => ({
        t: `${b.rangeStart.toFixed(2)}–${b.rangeEnd.toFixed(2)}`,
        value: b.count,
      })),
    },
  ];

  return (
    <div
      data-testid="pivot-distribution"
      className="flex flex-col gap-3 border-t border-slate-100 pt-3 dark:border-[#232B36]"
    >
      <Chart
        ariaLabel={`${label || "value"} histogram; ${dist.histogram.length} bucket(s)${
          sliceClickable ? " (click a series to drill)" : ""
        }`}
        className="h-56 w-full"
        option={buildTimeseriesOption(histSeries, { family: "bars", unit: "calls" })}
        onPointClick={(params) => {
          if (!sliceClickable || !onSliceClick) return;
          const name = params.name ?? params.seriesName;
          if (typeof name === "string" && name.length > 0) onSliceClick(name);
        }}
      />

      <div className="flex flex-wrap gap-4">
        <Stat label="p50" value={dist.p50} unit={unit} />
        <Stat label="p90" value={dist.p90} unit={unit} />
        <Stat label="p99" value={dist.p99} unit={unit} />
      </div>
      <p className="font-mono text-[10px] text-slate-500 dark:text-[#8A96A5]">
        {dist.histogram.length} bucket(s); top decile accounts for{" "}
        {dist.pareto ? `${(dist.pareto.topDecileValuePct * 100).toFixed(1)}%` : "—"} of value.
      </p>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: Unit }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-[#8A96A5]">
        {label}
      </span>
      <span className="font-mono text-sm text-slate-900 dark:text-[#E8EDF2]">
        {value === null ? "—" : formatUnitValue(value, unit)}
      </span>
    </div>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-72 items-center justify-center rounded-md border border-dashed border-slate-200 text-xs text-slate-500 dark:border-[#232B36] dark:text-[#8A96A5]"
    >
      {label}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
    >
      {message}
    </div>
  );
}

function tableRows(series: Series[]): { label: string; value: string }[] {
  return series.map((s) => {
    const total = s.points.reduce(
      (acc, p) => (typeof p.value === "number" && Number.isFinite(p.value) ? acc + p.value : acc),
      0,
    );
    return { label: s.label, value: total.toString() };
  });
}
