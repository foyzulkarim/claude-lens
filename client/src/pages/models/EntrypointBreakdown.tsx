import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useLocation } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import { DataTable } from "../../components/DataTable.js";
import type { FilterState } from "../../filters/state.js";
import { entrypointHref } from "./drilldown.js";

/**
 * Entrypoint breakdown (pages spec §6 — "token flow per client
 * (cli / ide / sdk)"). One row per distinct entrypoint with input /
 * output / cache-read / cache-create tokens plus computed cost. Each
 * row drills to `/sessions?entrypoint=<x>` (the Sessions page URL
 * schema understands `entrypoint=<csv>` as a filter dimension —
 * `shared/sessions-contract.ts:SessionListParams.entrypoint`).
 */

export interface EntrypointBreakdownProps {
  data: Series[] | undefined;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

interface EntrypointRow {
  entrypoint: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costComputed: number;
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

function deriveRows(data: Series[] | undefined): EntrypointRow[] {
  if (!data || data.length === 0) return [];
  const keys = new Set(data.map((s) => s.label || s.dimensionKey).filter((k) => k.length > 0));
  const rows: EntrypointRow[] = [];
  for (const entrypoint of keys) {
    const serieses = data.filter((s) => (s.label || s.dimensionKey) === entrypoint);
    rows.push({
      entrypoint,
      inputTokens: sumMeasure(serieses, "inputTokens"),
      outputTokens: sumMeasure(serieses, "outputTokens"),
      cacheReadTokens: sumMeasure(serieses, "cacheReadTokens"),
      cacheCreateTokens: sumMeasure(serieses, "cacheCreateTokens"),
      costComputed: sumMeasure(serieses, "costComputed"),
    });
  }
  return rows.sort((a, b) => b.costComputed - a.costComputed);
}

const COMPACT_INT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 0,
});
const CURRENCY_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const columnHelper = createColumnHelper<EntrypointRow>();

export function EntrypointBreakdown({
  data,
  filters,
  isPending,
  isError,
  error,
}: EntrypointBreakdownProps) {
  const [, navigate] = useLocation();
  const columns = useMemo<ColumnDef<EntrypointRow, unknown>[]>(
    () => [
      columnHelper.accessor("entrypoint", {
        header: "Entrypoint",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("inputTokens", {
        header: "Input tok",
        meta: { align: "right", mono: true },
        cell: (info) => COMPACT_INT.format(info.getValue()),
      }),
      columnHelper.accessor("outputTokens", {
        header: "Output tok",
        meta: { align: "right", mono: true },
        cell: (info) => COMPACT_INT.format(info.getValue()),
      }),
      columnHelper.accessor("cacheReadTokens", {
        header: "Cache read",
        meta: { align: "right", mono: true },
        cell: (info) => COMPACT_INT.format(info.getValue()),
      }),
      columnHelper.accessor("cacheCreateTokens", {
        header: "Cache create",
        meta: { align: "right", mono: true },
        cell: (info) => COMPACT_INT.format(info.getValue()),
      }),
      columnHelper.accessor("costComputed", {
        header: "Cost",
        meta: { align: "right", mono: true },
        cell: (info) => CURRENCY_FORMAT.format(info.getValue()),
      }),
    ],
    [],
  );
  const rows = useMemo(() => deriveRows(data), [data]);

  return (
    <section
      data-testid="entrypoint-breakdown"
      aria-labelledby="entrypoint-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id="entrypoint-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Entrypoint breakdown
      </h2>
      <p className="mt-1 font-mono text-[11px] text-slate-600 dark:text-[#8A96A5]">
        Token flow per client (cli / ide / sdk)
      </p>
      <div className="mt-3">
        {isError ? (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error?.message ?? "Failed to load entrypoint data"}
          </p>
        ) : (
          <DataTable<EntrypointRow>
            data={rows}
            columns={columns as ColumnDef<EntrypointRow, unknown>[]}
            label="Entrypoint breakdown"
            isLoading={isPending}
            empty="No entrypoint data in this range."
            getRowId={(row) => row.entrypoint}
            onRowClick={(row) => navigate(entrypointHref(row.entrypoint, filters))}
            getRowActionLabel={(row) => `View sessions for entrypoint ${row.entrypoint}`}
          />
        )}
      </div>
    </section>
  );
}
