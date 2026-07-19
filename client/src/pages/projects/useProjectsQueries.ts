import { keepPreviousData, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Grain, Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { type FilterState, filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useStableNow } from "../dashboard/useStableNow.js";

/**
 * The Projects page's single TanStack hook bundle (ARCH
 * `specs/architecture/ARCH-projects-page.md` A3). Mirrors
 * `useModelsQueries` — memoizes each query body on the URL's stable
 * filter identity + resolved range + grain + `now` (default
 * `useStableNow` ticking on 60s), so the bundle produces one cache
 * entry per (filters, grain, now[, selectedProjectId]) tuple and
 * unrelated re-renders don't churn query identities.
 *
 * Three queries, three distinct families:
 *
 *   • `composition` — `time × project × costComputed`. Powers the
 *     spend-composition stacked-area (Section A). `compare:
 *     "previous-period"` so the legend can opt into a ghost series
 *     later.
 *   • `efficiency` — `project × {costComputed, sessions, 4 tokens,
 *     turns}`. Powers the per-project efficiency table (Section B).
 *     The seven measures share one query body because the panel
 *     derives all five ratio columns client-side from this batch
 *     (same pattern as Models' `efficiency`).
 *   • `branches` — `gitBranch × costComputed`, with
 *     `filters.project = [selectedProjectId]`. Powers the per-branch
 *     breakdown panel (Section C). Re-keys when `selectedProjectId`
 *     changes; the global URL chips are preserved alongside the
 *     selected-project filter.
 *
 * All three queries use `keepPreviousData` so fast filter-bar toggles
 * keep the previous series visible — `isPending` only flashes when the
 * query identity genuinely changes.
 */
export interface ProjectsQueries {
  filters: FilterState;
  grain: Grain;
  /** Time × project stacked-area for Section A. */
  composition: UseQueryResult<Series[] | undefined>;
  /** Per-project ratios for Section B. */
  efficiency: UseQueryResult<Series[] | undefined>;
  /** Per-branch $ for Section C. `null` when `selectedProjectId` is unset. */
  branches: UseQueryResult<Series[] | undefined> | null;
}

/** Shared query-args shape — lets every memoized `SeriesMetricsQuery`
 * re-derive from a stable (filtersKey, grain, now) tuple without
 * re-deriving `filtersToQuery` per family. */
function useQueryArgs(filters: FilterState, grain: Grain, now: Date, filtersKey: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const base = useMemo(
    () => ({ grain, ...filtersToQuery(filters, now) }),
    [filtersKey, grain, now],
  );
  return base;
}

function makeQuery(
  measures: SeriesMetricsQuery["measures"],
  dimensions: SeriesMetricsQuery["dimensions"],
  args: {
    grain: Grain;
    range: SeriesMetricsQuery["range"];
    filters?: SeriesMetricsQuery["filters"];
  },
  compare: SeriesMetricsQuery["compare"] = undefined,
): SeriesMetricsQuery {
  return {
    measures,
    dimensions,
    compare,
    ...args,
  };
}

export function useProjectsQueries(
  filters: FilterState,
  grain: Grain,
  selectedProjectId: string | null,
  injectedNow?: Date,
): ProjectsQueries {
  const now = useStableNow(injectedNow);
  const filtersKey = serializeFilters(filters);
  const args = useQueryArgs(filters, grain, now, filtersKey);

  // Composition — daily spend × project, with compare so the legend
  // can opt into a ghost overlay later (the spec doesn't ship the
  // toggle in V2; the wiring is here for #P4-13's premium upgrade).
  const compositionQuery = useMemo<SeriesMetricsQuery>(
    () => makeQuery(["costComputed"], ["time", "project"], args, "previous-period"),
    [args],
  );

  // Efficiency — one query carries every measure the table needs to
  // derive ratios client-side. Same shape as Models' `efficiency`
  // query body, dimension swapped from `model` to `project`.
  const efficiencyQuery = useMemo<SeriesMetricsQuery>(
    () =>
      makeQuery(
        [
          "costComputed",
          "sessions",
          "inputTokens",
          "outputTokens",
          "cacheReadTokens",
          "cacheCreateTokens",
          "turns",
        ],
        ["project"],
        args,
        "previous-period",
      ),
    [args],
  );

  // Branches — `filters: { project: [selectedProjectId] ∪ ...globalProject }`.
  // Merges the selected project into the existing global project chip
  // so the URL contract stays consistent: the same drill-in lands
  // regardless of whether the user drilled via Section A or Section B.
  //
  // `branchesQuery` is always a stable `SeriesMetricsQuery` so the
  // hook order never shifts (React's "rules of hooks" requirement);
  // `enabled: false` flips the actual fetch off when no project is
  // selected. The placeholder range/dimensions stay valid for the
  // route validator — the call never reaches the server while
  // disabled.
  const branchesQuery = useMemo<SeriesMetricsQuery>(() => {
    const baseFilters = args.filters ?? {};
    const existingProject = baseFilters.project ?? [];
    const mergedProject = selectedProjectId
      ? [...new Set([...existingProject, selectedProjectId])].sort()
      : existingProject;
    return {
      measures: ["costComputed"],
      dimensions: ["gitBranch"],
      ...args,
      filters: { ...baseFilters, project: mergedProject },
    };
  }, [args, selectedProjectId]);

  const composition = useQuery({
    queryKey: qk.metrics(compositionQuery),
    queryFn: ({ signal }) => postMetrics(compositionQuery, signal),
    placeholderData: keepPreviousData,
  });

  const efficiency = useQuery({
    queryKey: qk.metrics(efficiencyQuery),
    queryFn: ({ signal }) => postMetrics(efficiencyQuery, signal),
    placeholderData: keepPreviousData,
  });

  const branchesRaw = useQuery({
    queryKey: qk.metrics(branchesQuery),
    queryFn: ({ signal }) => postMetrics(branchesQuery, signal),
    placeholderData: keepPreviousData,
    enabled: selectedProjectId !== null,
  });

  return {
    filters,
    grain,
    composition,
    efficiency,
    branches: selectedProjectId === null ? null : branchesRaw,
  };
}
