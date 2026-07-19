import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import { useLocation } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import { DataTable } from "../../components/DataTable.js";
import type { FilterState } from "../../filters/state.js";
import { projectHref } from "./drilldown.js";
import {
  formatCompactTokens,
  formatCount,
  formatCurrency,
  formatPercentFraction,
  lastActiveFrom,
} from "./format.js";

/**
 * Per-project efficiency table (pages spec §5 rows 1 + 3 + 5).
 * Combines "Spend by project + WoW growth", "Per-project
 * efficiency table ($/session, cache %, tokens/turn, gate pass
 * rate, last active)", and "Project → sessions" — three spec rows
 * that share one row shape, so they collapse into one table here
 * (spec beats mockup; the mockup splits them visually but the
 * data shape is identical).
 *
 * All ratios are derived client-side from the `efficiency` query
 * batch — same `(measure × project)` shape, divided as needed.
 * No server round-trip per ratio (architecture decision A5).
 *
 * Gate pass-rate reserves its column for #P4-12 (per the issue
 * acceptance text): the cell renders `—` until real values flow.
 */

interface EfficiencyRow {
  project: string;
  spend: number;
  spendPrev: number | undefined;
  sessions: number;
  cacheHitPct: number | null;
  tokensPerTurn: number | null;
  dollarsPerSession: number | null;
  lastActive: string | undefined;
  gatePassRate: number | null;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** Sums the `points` of every series in `serieses` that match
 * `measure`, ignoring non-finite values. Mirrors the same helper
 * inside `models/EfficiencyTable.tsx`; kept inline here rather
 * than promoted to a shared module until a third panel needs it. */
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

/** Same as `sumMeasure` but on `compareGhost` (the engine's
 * previous-equal-period points). Used to derive the WoW delta. */
function sumMeasurePrev(serieses: Series[], measure: Series["measure"]): number | undefined {
  let seenAny = false;
  let sum = 0;
  for (const s of serieses) {
    if (s.measure !== measure) continue;
    const ghost = s.compareGhost;
    if (!ghost) continue;
    seenAny = true;
    for (const p of ghost) {
      sum += typeof p.value === "number" && Number.isFinite(p.value) ? p.value : 0;
    }
  }
  return seenAny ? sum : undefined;
}

/**
 * Mean per-project gate pass rate (#P4-12). The engine emits
 * `gatePassRate` as a session-mean per bucket (T5); averaging those
 * bucket means per project gives a stable per-project rate. `null`
 * buckets (no gate data) are excluded — never fabricated as 0.
 */
function avgGatePassRate(serieses: Series[]): number | null {
  let total = 0;
  let n = 0;
  for (const s of serieses) {
    if (s.measure !== "gatePassRate") continue;
    for (const p of s.points) {
      if (typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
      total += p.value;
      n += 1;
    }
  }
  return n > 0 ? total / n : null;
}

function lastBucketTimestamp(serieses: Series[]): string | undefined {
  let latest: string | undefined;
  for (const s of serieses) {
    for (const p of s.points) {
      if (typeof p.value !== "number" || !Number.isFinite(p.value) || p.value <= 0) continue;
      if (!latest || p.t.localeCompare(latest) > 0) latest = p.t;
    }
  }
  return latest;
}

/** Derives one `EfficiencyRow` per project. Reads the engine's
 * series set, grouped by `series.label` (the project's dimension
 * value), measuring every ratio cell the table renders. */
function deriveRows(serieses: Series[] | undefined): EfficiencyRow[] {
  if (!serieses || serieses.length === 0) return [];

  const labels = new Set<string>();
  for (const s of serieses) {
    const label = s.label || s.dimensionKey;
    if (label) labels.add(label);
  }

  const rows: EfficiencyRow[] = [];
  for (const project of labels) {
    const projectSeries = serieses.filter((s) => (s.label || s.dimensionKey) === project);

    const cost = sumMeasure(projectSeries, "costComputed");
    const costPrev = sumMeasurePrev(projectSeries, "costComputed");
    const sessions = sumMeasure(projectSeries, "sessions");
    const input = sumMeasure(projectSeries, "inputTokens");
    const output = sumMeasure(projectSeries, "outputTokens");
    const cacheRead = sumMeasure(projectSeries, "cacheReadTokens");
    const cacheCreate = sumMeasure(projectSeries, "cacheCreateTokens");
    const turns = sumMeasure(projectSeries, "turns");

    const eligible = input + cacheRead + cacheCreate;
    const cacheHitPct = eligible > 0 ? cacheRead / eligible : null;

    rows.push({
      project,
      spend: cost,
      spendPrev: costPrev,
      sessions,
      cacheHitPct,
      tokensPerTurn: safeDivide(input + output, turns),
      dollarsPerSession: safeDivide(cost, sessions),
      lastActive: lastBucketTimestamp(projectSeries),
      // Per-project mean gate pass rate (T13, #P4-12). Cell renders
      // "—" when the engine emits all-null buckets for the project
      // (cold cache, no analyzed sessions).
      gatePassRate: avgGatePassRate(projectSeries),
    });
  }

  return rows.sort((a, b) => b.spend - a.spend);
}

/** `undefined` when the comparison population is missing so the
 * WoW column renders an honest `—` rather than a divide-by-zero
 * "+Inf%". Mirrors `StatCardsRow.tsx`'s `combinedPreviousTotal`. */
function formatWoW(current: number, previous: number | undefined): string {
  if (previous === undefined || !Number.isFinite(previous) || previous === 0) return "—";
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "▲" : pct < 0 ? "▼" : ""} ${Math.abs(pct)}%`.trim();
}

const columnHelper = createColumnHelper<EfficiencyRow>();

export interface EfficiencyTableProps {
  data: Series[] | undefined;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
  /** Injected `now` for deterministic "last active" rendering. */
  now?: Date;
}

export function EfficiencyTable({
  data,
  filters,
  isPending,
  isError,
  error,
  now,
}: EfficiencyTableProps) {
  const [, navigate] = useLocation();

  const columns = useMemo<ColumnDef<EfficiencyRow, unknown>[]>(
    () => [
      columnHelper.accessor("project", {
        header: "Project",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("spend", {
        header: "Spend",
        meta: { align: "right", mono: true },
        cell: (info) => formatCurrency(info.getValue()),
      }),
      columnHelper.accessor("spendPrev", {
        header: "WoW",
        meta: { align: "right", mono: true },
        cell: (info) => formatWoW(info.row.original.spend, info.getValue()),
      }),
      columnHelper.accessor("sessions", {
        header: "Sessions",
        meta: { align: "right", mono: true },
        cell: (info) => formatCount(info.getValue()),
      }),
      columnHelper.accessor("dollarsPerSession", {
        header: "$ / session",
        meta: { align: "right", mono: true },
        cell: (info) => formatCurrency(info.getValue()),
      }),
      columnHelper.accessor("cacheHitPct", {
        header: "Cache %",
        meta: { align: "right", mono: true },
        cell: (info) => formatPercentFraction(info.getValue()),
      }),
      columnHelper.accessor("tokensPerTurn", {
        header: "Tok / turn",
        meta: { align: "right", mono: true },
        cell: (info) => formatCompactTokens(info.getValue()),
      }),
      columnHelper.accessor("gatePassRate", {
        header: "Gate pass",
        meta: { align: "right", mono: true },
        cell: () => "—",
      }),
      columnHelper.accessor("lastActive", {
        header: "Last active",
        meta: { align: "right", mono: true },
        cell: (info) => lastActiveFrom(info.getValue(), now),
      }),
    ],
    [now],
  );

  const rows = useMemo(() => deriveRows(data), [data]);

  if (isError) {
    return (
      <section
        data-testid="projects-efficiency"
        aria-labelledby="projects-efficiency-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="projects-efficiency-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Projects
        </h2>
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error?.message ?? "Failed to load projects"}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="projects-efficiency"
      aria-labelledby="projects-efficiency-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2
        id="projects-efficiency-heading"
        className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
      >
        Projects
      </h2>
      <div className="mt-3">
        <DataTable<EfficiencyRow>
          data={rows}
          columns={columns as ColumnDef<EfficiencyRow, unknown>[]}
          label="Projects efficiency table"
          isLoading={isPending}
          empty="No project data in this range."
          getRowId={(row) => row.project}
          onRowClick={(row) => navigate(projectHref(row.project, filters))}
          getRowActionLabel={(row) => `View sessions for project ${row.project}`}
          initialSorting={[{ id: "spend", desc: true }]}
        />
      </div>
    </section>
  );
}
