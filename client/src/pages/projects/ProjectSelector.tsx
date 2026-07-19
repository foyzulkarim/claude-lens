import { keepPreviousData, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { type FilterState, filtersToQuery, serializeFilters } from "../../filters/state.js";
import { TOGGLE_ACTIVE_CLASS, TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { useStableNow } from "../dashboard/useStableNow.js";

/**
 * Tiny selector that picks one of the projects visible in the
 * efficiency query — a per-row chip row that drives `Section C`
 * (branch breakdown). The list is read from the `efficiency`
 * `Series[]` it already received from `useProjectsQueries`, so the
 * selector does NOT fire a separate query.
 *
 * Reasons it lives here, not inside `BranchBreakdown`:
 *   1. The selection state is page-level (multiple panels could care
 *      about it), so lifting it above keeps the page shell the sole
 *      owner (no Redux/context needed).
 *   2. The chip row belongs visually under Section A's chart and
 *      above the branch panel — co-locating with Section C is fine
 *      but readers wiring up the layout benefit from a separate
 *      component with explicit props.
 *   3. Mirrors how `sessions/...` pages split layout/control
 *      components (`SessionBrowser`, `SessionsFilters`,
 *      `SessionCompare`) — small files per concern.
 */
export interface ProjectSelectorProps {
  /** All visible projects, ordered by descending `costComputed`. */
  projects: string[];
  /** Currently selected project — section C uses this to filter. */
  selectedProjectId: string | null;
  onSelect: (project: string | null) => void;
  isPending?: boolean;
}

/**
 * Pure helper: derives the visible project list (sorted descending by
 * `$`) from an `efficiency` `Series[]` response. Exported so the
 * panel-level smoke test can pin the ordering without standing up a
 * TanStack client.
 */
export function projectsFromEfficiency(series: Series[] | undefined): string[] {
  if (!series || series.length === 0) return [];

  const byLabel = new Map<string, number>();
  for (const s of series) {
    if (s.measure !== "costComputed") continue;
    const label = s.label || s.dimensionKey;
    if (!label) continue;
    let total = 0;
    for (const point of s.points) {
      const value = point.value;
      if (typeof value === "number" && Number.isFinite(value)) total += value;
    }
    // Multi-dimensional Series (multiple measure × dimension pairings)
    // would double-count without a per-label cap. The hook bundle
    // requests a single dimension (`project`), so each label appears
    // at most in one costComputed Series — but be defensive anyway.
    const existing = byLabel.get(label) ?? 0;
    byLabel.set(label, Math.max(existing, total));
  }

  return [...byLabel.entries()]
    .map(([project, cost]) => ({ project, cost }))
    .sort((a, b) => b.cost - a.cost)
    .map(({ project }) => project);
}

export function ProjectSelector({
  projects,
  selectedProjectId,
  onSelect,
  isPending,
}: ProjectSelectorProps) {
  if (isPending && projects.length === 0) {
    return (
      <section
        data-testid="project-selector"
        aria-labelledby="project-selector-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="project-selector-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Project selector
        </h2>
        <p className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">Loading projects…</p>
      </section>
    );
  }

  if (projects.length === 0) {
    return (
      <section
        data-testid="project-selector"
        aria-labelledby="project-selector-heading"
        className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
      >
        <h2
          id="project-selector-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Project selector
        </h2>
        <p role="status" className="mt-3 text-sm text-slate-500 dark:text-[#8B98A9]">
          No projects in this range.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="project-selector"
      aria-labelledby="project-selector-heading"
      className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="project-selector-heading"
          className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]"
        >
          Pick a project to break down by branch
        </h2>
        {selectedProjectId !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-[11px] text-slate-600 underline-offset-2 hover:underline dark:text-[#8A96A5]"
          >
            Clear
          </button>
        )}
      </div>
      <fieldset aria-label="Project chips" className="flex flex-wrap gap-1">
        {projects.map((project) => {
          const active = project === selectedProjectId;
          return (
            <button
              key={project}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(project)}
              className={clsx(TOGGLE_CLASS, active && TOGGLE_ACTIVE_CLASS)}
            >
              {project}
            </button>
          );
        })}
      </fieldset>
    </section>
  );
}

/**
 * The hook piece — kept here, not in `useProjectsQueries.ts`, so the
 * selector can be slotted in as a presentation component without
 * forcing the page to re-pull the same query. Since the efficiency
 * `Series[]` already carries the project list (by derivation above),
 * callers fire the helper against the existing data instead.
 *
 * Provided as a thin wrapper around `useQuery` + `topNWithOther`-
 * equivalent derivation for the case where a caller wants its own
 * `projects` feed (e.g. a future Explore-mode drill). Currently
 * unused by `Projects.tsx` but kept exported for downstream panels.
 */
export function useProjectListQuery(
  filters: FilterState,
  grain: SeriesMetricsQuery["grain"],
  injectedNow?: Date,
) {
  const now = useStableNow(injectedNow);
  const filtersKey = serializeFilters(filters);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(() => {
    const { range, filters: chipFilters } = filtersToQuery(filters, now);
    return {
      measures: ["costComputed"],
      dimensions: ["project"],
      grain,
      range,
      ...(chipFilters && Object.keys(chipFilters).length > 0 ? { filters: chipFilters } : {}),
    };
  }, [filtersKey, grain, now]);

  return useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });
}
