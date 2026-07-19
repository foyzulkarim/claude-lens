import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Series } from "../../../../shared/metrics-contract.js";
import type { FilterState } from "../../filters/state.js";
import { branchHref } from "./drilldown.js";
import { formatCurrency } from "./format.js";

interface BranchRow {
  branch: string;
  cost: number;
}

function deriveRows(serieses: Series[] | undefined): BranchRow[] {
  if (!serieses) return [];
  const labels = new Set<string>();
  for (const s of serieses) {
    const label = s.label || s.dimensionKey;
    if (label) labels.add(label);
  }
  const rows: BranchRow[] = [];
  for (const branch of labels) {
    const seriesForBranch = serieses.filter((s) => (s.label || s.dimensionKey) === branch);
    let cost = 0;
    for (const s of seriesForBranch) {
      for (const p of s.points) {
        const v = p.value;
        if (typeof v === "number" && Number.isFinite(v)) cost += v;
      }
    }
    rows.push({ branch, cost });
  }
  return rows.sort((a, b) => b.cost - a.cost);
}

/** Default cap for the top-N+more bar list (decision A6 of
 * `specs/architecture/ARCH-projects-page.md`). Three branches
 * matches `projects.html`'s `agentic-swe-vod` section verbatim;
 * the toggle expands to the full list when more branches exist. */
export const DEFAULT_TOP_N = 3;

export interface BranchBreakdownProps {
  data: Series[] | undefined;
  /** The currently selected project; the section heading `<project> · by branch`.
   * `null` means "no project selected — show the empty state." */
  project: string | null;
  filters: FilterState;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}

/**
 * Per-branch breakdown within a project (pages spec §5 row 4).
 * Horizontally-bars list mirroring the mockup's `agentic-swe-vod · by
 * branch` section. Top-N + "show all" disclosure: the default shows
 * the 3 most expensive branches (the spec-vs-mockup layout), with a
 * toggle to expand when the project has more.
 *
 * Bar click drills to `/sessions?project=<p>&branch=<b>&<preserved>`
 * via `branchHref` — the same URL contract the Sessions page parses
 * out of its `?project=` and `?branch=` chips.
 */
export function BranchBreakdown({
  data,
  project,
  filters,
  isPending,
  isError,
  error,
}: BranchBreakdownProps) {
  const [showAll, setShowAll] = useState(false);
  const [, navigate] = useLocation();

  const allRows = useMemo(() => deriveRows(data), [data]);

  const visibleRows = useMemo(() => {
    if (showAll || allRows.length <= DEFAULT_TOP_N) return allRows;
    return allRows.slice(0, DEFAULT_TOP_N);
  }, [allRows, showAll]);

  const maxCost = useMemo(() => {
    let max = 0;
    for (const row of allRows) if (row.cost > max) max = row.cost;
    return max;
  }, [allRows]);

  if (project === null) {
    return (
      <section
        data-testid="branch-breakdown"
        aria-labelledby="branch-breakdown-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="branch-breakdown-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          By branch
        </h2>
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Pick a project above to see its branch-level spend.
        </p>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        data-testid="branch-breakdown"
        aria-labelledby="branch-breakdown-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="branch-breakdown-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          {project} · by branch
        </h2>
        <p role="alert" className="mt-3 text-sm text-[#B23A3A] dark:text-[#E05252]">
          {error?.message ?? "Failed to load branch data"}
        </p>
      </section>
    );
  }

  if (isPending && allRows.length === 0) {
    return (
      <section
        data-testid="branch-breakdown"
        aria-labelledby="branch-breakdown-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="branch-breakdown-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          {project} · by branch
        </h2>
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          Loading branches for {project}…
        </p>
      </section>
    );
  }

  if (allRows.length === 0) {
    return (
      <section
        data-testid="branch-breakdown"
        aria-labelledby="branch-breakdown-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="branch-breakdown-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          {project} · by branch
        </h2>
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          No branch-level spend for {project} in this range.
        </p>
      </section>
    );
  }

  const hiddenCount = allRows.length - visibleRows.length;

  return (
    <section
      data-testid="branch-breakdown"
      aria-labelledby="branch-breakdown-heading"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="branch-breakdown-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          {project} · by branch
        </h2>
        {hiddenCount > 0 && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-[11px] text-slate-600 underline-offset-2 hover:underline dark:text-[#8A96A5]"
          >
            Show all {allRows.length} branches
          </button>
        )}
        {showAll && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-[11px] text-slate-600 underline-offset-2 hover:underline dark:text-[#8A96A5]"
          >
            Show top {DEFAULT_TOP_N}
          </button>
        )}
      </div>

      <ul className="mt-3 flex flex-col gap-2" aria-label="Branch cost bars">
        {visibleRows.map((row) => {
          const widthPct = maxCost > 0 ? Math.max(2, (row.cost / maxCost) * 100) : 2;
          return (
            <li key={row.branch} className="flex items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => navigate(branchHref(project, row.branch, filters))}
                aria-label={`View sessions for branch ${row.branch} in project ${project}`}
                className="grid w-full grid-cols-[10rem_1fr_5rem] items-center gap-3 rounded px-1 py-1 text-left hover:bg-slate-50 dark:hover:bg-[#1B2230]"
              >
                <span
                  className="truncate font-mono text-[12px] text-slate-700 dark:text-[#C9D2DC]"
                  title={row.branch}
                >
                  {row.branch}
                </span>
                <span
                  role="presentation"
                  aria-hidden="true"
                  className="relative h-3 overflow-hidden rounded bg-slate-100 dark:bg-[#1B2230]"
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded bg-[#E8A33D] dark:bg-[#E8A33D]"
                    style={{ width: `${widthPct}%` }}
                  />
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums text-slate-700 dark:text-[#C9D2DC]">
                  {formatCurrency(row.cost)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
