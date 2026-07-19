import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useLocation } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import { DataTable } from "../../components/DataTable.js";
import { TierBadge } from "../../components/TierBadge.js";
import type { FilterState } from "../../filters/state.js";
import { modelHref } from "./drilldown.js";

/**
 * 🟡 Latency by model (pages spec §6 — "fallback timestamp deltas" until
 * #P4-13 / #45 upgrades the page to 🔴 via premium `api_duration_ms`).
 *
 * Derives per-model latency from two existing measures: `wallMinutes` ÷
 * `apiCalls` per model, then converts minutes-per-call to a display
 * unit. This is the spec's "coarse timestamp fallback": sessions record
 * wall-clock duration, so calls-per-minute → seconds-per-call is a
 * rough proxy for inter-arrival latency when no `api_duration_ms`
 * capture exists (when it does, #P4-13 swaps this panel for the real
 * p50/p90 distribution).
 */

export interface LatencyByModelProps {
  data: Series[] | undefined;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

interface LatencyRow {
  model: string;
  /** Mean seconds per call (wallMinutes ÷ apiCalls × 60). */
  secondsPerCall: number | null;
  callCount: number;
}

function sumMeasure(serieses: Series[], measure: Series["measure"]): number {
  let sum = 0;
  for (const s of serieses) {
    if (s.measure !== measure) continue;
    for (const p of s.points) {
      sum += typeof p.value === "number" && Number.isFinite(p.value) ? p.value : 0;
    }
  }
  return sum;
}

function deriveRows(data: Series[] | undefined): LatencyRow[] {
  if (!data || data.length === 0) return [];
  const modelKeys = new Set(data.map((s) => s.label || s.dimensionKey).filter((k) => k.length > 0));
  const rows: LatencyRow[] = [];
  for (const model of modelKeys) {
    const modelSeries = data.filter((s) => (s.label || s.dimensionKey) === model);
    const wallMinutes = sumMeasure(modelSeries, "wallMinutes");
    const apiCalls = sumMeasure(modelSeries, "apiCalls");
    if (apiCalls === 0) {
      rows.push({ model, secondsPerCall: null, callCount: 0 });
      continue;
    }
    const secondsPerCall = (wallMinutes * 60) / apiCalls;
    rows.push({ model, secondsPerCall, callCount: apiCalls });
  }
  return rows.sort((a, b) => {
    const aV = a.secondsPerCall ?? Number.POSITIVE_INFINITY;
    const bV = b.secondsPerCall ?? Number.POSITIVE_INFINITY;
    return aV - bV;
  });
}

function formatSeconds(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1) return `${(value * 1000).toFixed(0)}ms`;
  if (value < 60) return `${value.toFixed(1)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value - minutes * 60);
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

const INT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const columnHelper = createColumnHelper<LatencyRow>();

export function LatencyByModel({ data, filters, isPending, isError, error }: LatencyByModelProps) {
  const [, navigate] = useLocation();
  const columns = useMemo<ColumnDef<LatencyRow, unknown>[]>(
    () => [
      columnHelper.accessor("model", {
        header: "Model",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("secondsPerCall", {
        header: "Avg time / call",
        meta: { align: "right", mono: true },
        cell: (info) => formatSeconds(info.getValue()),
      }),
      columnHelper.accessor("callCount", {
        header: "Calls",
        meta: { align: "right", mono: true },
        cell: (info) => INT_FORMAT.format(info.getValue()),
      }),
    ],
    [],
  );
  const rows = useMemo(() => deriveRows(data), [data]);

  return (
    <section
      data-testid="latency-by-model"
      aria-labelledby="latency-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between">
        <h2
          id="latency-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Latency by model (avg time / call)
        </h2>
        <TierBadge level="estimated">timestamp fallback</TierBadge>
      </div>
      <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-[#8A96A5]">
        wallMinutes ÷ apiCalls · per-model proxy for inter-call latency · premium capture upgrades
        to p50 / p90
      </p>
      <div className="mt-3">
        {isError ? (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error?.message ?? "Failed to load latency data"}
          </p>
        ) : (
          <DataTable<LatencyRow>
            data={rows}
            columns={columns as ColumnDef<LatencyRow, unknown>[]}
            label="Latency by model"
            isLoading={isPending}
            empty="No latency data in this range."
            getRowId={(row) => row.model}
            onRowClick={(row) => navigate(modelHref(row.model, filters))}
            getRowActionLabel={(row) => `View sessions for model ${row.model}`}
          />
        )}
      </div>
    </section>
  );
}
