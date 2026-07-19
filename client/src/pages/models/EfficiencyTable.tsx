import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useLocation } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import { DataTable } from "../../components/DataTable.js";
import type { FilterState } from "../../filters/state.js";
import { modelHref } from "./drilldown.js";

/**
 * Per-model efficiency ratios (pages spec §6 "Efficiency ratios by
 * model: output tokens per $, cache hit %, tokens/turn"). All ratios
 * are derived client-side from the same `efficiency` query batch
 * (input + output + cacheRead + cacheCreate + costComputed + turns ×
 * dimension `model`) — no server round-trip per ratio (decision A5).
 *
 * The table rows are also the page's drill surface — clicking a row
 * navigates to `/sessions?model=<x>` retaining the global filters (the
 * row click handler is implemented via `DataTable`'s `onRowClick`).
 */

export interface EfficiencyTableProps {
  data: Series[] | undefined;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

interface EfficiencyRow {
  model: string;
  outTokensPerDollar: number | null;
  cacheHitPct: number | null;
  tokensPerTurn: number | null;
  dollarsPerTurn: number | null;
}

/** Sums the `points` of every series in `serieses` that match `measure`,
 * ignoring non-finite values. One row can host multiple matching series
 * when the engine fuses data (rare for non-time dims but defensive). */
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

const INT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const COMPACT_INT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});
const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PERCENT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

function deriveRows(data: Series[] | undefined): EfficiencyRow[] {
  if (!data || data.length === 0) return [];

  // The engine returns one `Series` per (measure, dimensionKey) for
  // non-time queries. We pivot to "per-model" rows by walking the
  // model-keyed Series in any order and reading each measure.
  const modelKeys = new Set(data.map((s) => s.label || s.dimensionKey).filter((k) => k.length > 0));

  const rows: EfficiencyRow[] = [];
  for (const model of modelKeys) {
    // Pick this model's slices for each measure by `label` match.
    // Multi-model sessions can double-count (engine.ts:174), but we
    // don't mind — the panel's job is ratio, not totals.
    const modelSeries = data.filter((s) => (s.label || s.dimensionKey) === model);
    const input = sumMeasure(modelSeries, "inputTokens");
    const output = sumMeasure(modelSeries, "outputTokens");
    const cacheRead = sumMeasure(modelSeries, "cacheReadTokens");
    const cacheCreate = sumMeasure(modelSeries, "cacheCreateTokens");
    const cost = sumMeasure(modelSeries, "costComputed");
    const turns = sumMeasure(modelSeries, "turns");

    const eligible = input + cacheRead + cacheCreate;
    const cacheHitPct = eligible > 0 ? cacheRead / eligible : null;

    rows.push({
      model,
      outTokensPerDollar: safeDivide(output, cost),
      cacheHitPct,
      tokensPerTurn: safeDivide(input + output, turns),
      dollarsPerTurn: safeDivide(cost, turns),
    });
  }

  return rows.sort((a, b) => {
    const aCost = a.dollarsPerTurn ?? 0;
    const bCost = b.dollarsPerTurn ?? 0;
    return bCost - aCost;
  });
}

const columnHelper = createColumnHelper<EfficiencyRow>();

export function EfficiencyTable({
  data,
  filters,
  isPending,
  isError,
  error,
}: EfficiencyTableProps) {
  const [, navigate] = useLocation();

  const columns = useMemo<ColumnDef<EfficiencyRow, unknown>[]>(
    () => [
      columnHelper.accessor("model", {
        header: "Model",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("outTokensPerDollar", {
        header: "Out tok / $",
        meta: { align: "right", mono: true },
        cell: (info) => {
          const value = info.getValue();
          return value === null || !Number.isFinite(value) ? "—" : INT_FORMAT.format(value);
        },
      }),
      columnHelper.accessor("cacheHitPct", {
        header: "Cache %",
        meta: { align: "right", mono: true },
        cell: (info) => {
          const value = info.getValue();
          return value === null || !Number.isFinite(value)
            ? "—"
            : `${PERCENT_FORMAT.format(value * 100)}%`;
        },
      }),
      columnHelper.accessor("tokensPerTurn", {
        header: "Tok / turn",
        meta: { align: "right", mono: true },
        cell: (info) => {
          const value = info.getValue();
          return value === null || !Number.isFinite(value) ? "—" : `${COMPACT_INT.format(value)}`;
        },
      }),
      columnHelper.accessor("dollarsPerTurn", {
        header: "$ / turn",
        meta: { align: "right", mono: true },
        cell: (info) => {
          const value = info.getValue();
          return value === null || !Number.isFinite(value) ? "—" : CURRENCY_FORMAT.format(value);
        },
      }),
    ],
    [],
  );

  const rows = useMemo(() => deriveRows(data), [data]);

  if (isError) {
    return (
      <section
        data-testid="efficiency-by-model"
        aria-labelledby="efficiency-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="efficiency-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Efficiency by model
        </h2>
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error?.message ?? "Failed to load efficiency data"}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="efficiency-by-model"
      aria-labelledby="efficiency-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id="efficiency-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Efficiency by model
      </h2>
      <div className="mt-3">
        <DataTable<EfficiencyRow>
          data={rows}
          columns={columns as ColumnDef<EfficiencyRow, unknown>[]}
          label="Efficiency by model"
          isLoading={isPending}
          empty="No model efficiency data in this range."
          getRowId={(row) => row.model}
          onRowClick={(row) => navigate(modelHref(row.model, filters))}
          getRowActionLabel={(row) => `View sessions for model ${row.model}`}
          initialSorting={[{ id: "dollarsPerTurn", desc: true }]}
        />
      </div>
    </section>
  );
}
