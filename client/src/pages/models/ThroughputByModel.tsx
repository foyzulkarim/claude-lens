import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useLocation } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import { DataTable } from "../../components/DataTable.js";
import { TierBadge } from "../../components/TierBadge.js";
import type { FilterState } from "../../filters/state.js";
import { modelHref } from "./drilldown.js";

/**
 * 🟡 Throughput by model (pages spec §6 — "coarse timestamp fallback"
 * until #P4-13 / #45). Derives per-model output tokens per second from
 * `outputTokens ÷ wallMinutes × 60`. The exact formula on the
 * premium-tier side is `output ÷ api_duration_ms`; this proxy uses
 * wall-clock session duration which bundles latency + idle time, so the
 * headline numbers are a *lower bound* — fine for "is one model
 * substantially faster than another", not for absolute throughput
 * claims.
 */

export interface ThroughputByModelProps {
  data: Series[] | undefined;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

interface ThroughputRow {
  model: string;
  tokensPerSecond: number | null;
  totalOutputTokens: number;
  /** True when this row's throughput came from observed `apiMs` (#P4-13). */
  observed: boolean;
}

interface ThroughputResult {
  rows: ThroughputRow[];
  /** True when every row with output used observed `apiMs` — drives the panel's tier badge. */
  observed: boolean;
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

function deriveResult(data: Series[] | undefined): ThroughputResult {
  if (!data || data.length === 0) return { rows: [], observed: false };
  const modelKeys = new Set(data.map((s) => s.label || s.dimensionKey).filter((k) => k.length > 0));
  const rows: ThroughputRow[] = [];
  for (const model of modelKeys) {
    const modelSeries = data.filter((s) => (s.label || s.dimensionKey) === model);
    const output = sumMeasure(modelSeries, "outputTokens");
    // Prefer observed api_duration (true generation-time throughput) over the
    // wall-clock proxy, which bundles idle time and only lower-bounds it.
    const apiMs = sumMeasure(modelSeries, "apiMs");
    if (apiMs > 0) {
      rows.push({
        model,
        tokensPerSecond: output / (apiMs / 1000),
        totalOutputTokens: output,
        observed: true,
      });
      continue;
    }
    const wallSeconds = sumMeasure(modelSeries, "wallMinutes") * 60;
    if (wallSeconds === 0) {
      rows.push({ model, tokensPerSecond: null, totalOutputTokens: output, observed: false });
      continue;
    }
    rows.push({
      model,
      tokensPerSecond: output / wallSeconds,
      totalOutputTokens: output,
      observed: false,
    });
  }
  rows.sort((a, b) => (b.tokensPerSecond ?? 0) - (a.tokensPerSecond ?? 0));
  const withOutput = rows.filter((r) => r.totalOutputTokens > 0);
  const observed = withOutput.length > 0 && withOutput.every((r) => r.observed);
  return { rows, observed };
}

const COMPACT_INT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const PLAIN_INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatTokensPerSecond(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `${COMPACT_INT.format(value)} tok/s`;
  return `${PLAIN_INT.format(value)} tok/s`;
}

const columnHelper = createColumnHelper<ThroughputRow>();

export function ThroughputByModel({
  data,
  filters,
  isPending,
  isError,
  error,
}: ThroughputByModelProps) {
  const [, navigate] = useLocation();
  const columns = useMemo<ColumnDef<ThroughputRow, unknown>[]>(
    () => [
      columnHelper.accessor("model", {
        header: "Model",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("tokensPerSecond", {
        header: "Avg output tok/s",
        meta: { align: "right", mono: true },
        cell: (info) => formatTokensPerSecond(info.getValue()),
      }),
      columnHelper.accessor("totalOutputTokens", {
        header: "Total output tokens",
        meta: { align: "right", mono: true },
        cell: (info) => COMPACT_INT.format(info.getValue()),
      }),
    ],
    [],
  );
  const { rows, observed } = useMemo(() => deriveResult(data), [data]);

  return (
    <section
      data-testid="throughput-by-model"
      aria-labelledby="throughput-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex items-center justify-between">
        <h2
          id="throughput-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Throughput by model (avg output tok/s)
        </h2>
        {observed ? (
          <TierBadge level="exact">observed api_duration</TierBadge>
        ) : (
          <TierBadge level="estimated">timestamp fallback</TierBadge>
        )}
      </div>
      <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-[#8A96A5]">
        {observed
          ? "outputTokens ÷ api_duration_ms · observed generation throughput"
          : "outputTokens ÷ wallMinutes · per-model proxy · premium capture upgrades to observed"}
      </p>
      <div className="mt-3">
        {isError ? (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error?.message ?? "Failed to load throughput data"}
          </p>
        ) : (
          <DataTable<ThroughputRow>
            data={rows}
            columns={columns as ColumnDef<ThroughputRow, unknown>[]}
            label="Throughput by model"
            isLoading={isPending}
            empty="No throughput data in this range."
            getRowId={(row) => row.model}
            onRowClick={(row) => navigate(modelHref(row.model, filters))}
            getRowActionLabel={(row) => `View sessions for model ${row.model}`}
          />
        )}
      </div>
    </section>
  );
}
