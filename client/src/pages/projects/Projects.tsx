import { useEffect, useMemo, useState } from "react";
import type { Grain } from "../../../../shared/metrics-contract.js";
import { useFilters } from "../../filters/useFilters.js";
import { BranchBreakdown } from "./BranchBreakdown.js";
import { EfficiencyTable } from "./EfficiencyTable.js";
import { ProjectSelector, projectsFromEfficiency } from "./ProjectSelector.js";
import { SpendComposition } from "./SpendComposition.js";
import { useProjectsQueries } from "./useProjectsQueries.js";

const GRAIN: Grain = "day";

/**
 * Projects page shell (ARCH §5 — Projects; the architecture doc
 * captured in `specs/architecture/ARCH-projects-page.md`). Composes
 * four sections in spec order:
 *
 *   1. SpendComposition       — stacked-area chart (time × project)
 *   2. ProjectSelector        — chip row that drives Section C
 *   3. EfficiencyTable        — per-project ratios + WoW + drill
 *   4. BranchBreakdown        — top-3 bars for the selected project
 *
 * Per the architecture's section-owned-state rule (decision A5
 * mirroring Dashboard / Models / Trends): every section owns its
 * own loading / empty / error state. The page shell is purely
 * layout glue, plus the `selectedProjectId` state the selector and
 * the branch panel share.
 *
 * Auto-select rule: when the efficiency query lands with at least
 * one project and the user hasn't explicitly picked one yet, the
 * top-cost project becomes the default. The `userSet` flag keeps
 * the auto-select from clobbering a deliberate click (a real UX
 * regression on rapid filter switches).
 */
export function Projects() {
  const { filters } = useFilters();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [userSet, setUserSet] = useState(false);

  const queries = useProjectsQueries(filters, GRAIN, selectedProjectId);

  // Derive the project list once the efficiency query lands.
  const projects = useMemo(
    () => projectsFromEfficiency(queries.efficiency.data),
    [queries.efficiency.data],
  );

  // Auto-select the top-cost project the first time the query lands,
  // unless the user has explicitly chosen one.
  useEffect(() => {
    if (userSet) return;
    if (projects.length === 0) return;
    if (selectedProjectId !== null) return;
    setSelectedProjectId(projects[0] ?? null);
  }, [projects, selectedProjectId, userSet]);

  // A project selection is only meaningful while it remains in the
  // filtered project list. Reset stale explicit selections so a URL
  // filter change cannot leave the branch panel headed by one project
  // while the visible chips (and current filter population) contain another.
  useEffect(() => {
    if (selectedProjectId === null || projects.length === 0) return;
    if (projects.includes(selectedProjectId)) return;
    setSelectedProjectId(null);
    setUserSet(false);
  }, [projects, selectedProjectId]);

  // If the user narrows filters to a single project, mirror the new
  // selection automatically — beats leaving the user staring at an
  // empty branch panel when the global filter just collapsed the list.
  useEffect(() => {
    if (userSet) return;
    if (projects.length !== 1) return;
    const only = projects[0] ?? null;
    if (only !== selectedProjectId) setSelectedProjectId(only);
  }, [projects, selectedProjectId, userSet]);

  const handleSelect = (next: string | null) => {
    setUserSet(true);
    setSelectedProjectId(next);
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Projects</h1>

      <SpendComposition
        data={queries.composition.data}
        filters={filters}
        grain={GRAIN}
        isPending={queries.composition.isPending}
        isError={queries.composition.isError}
        error={queries.composition.error}
      />

      <EfficiencyTable
        data={queries.efficiency.data}
        filters={filters}
        isPending={queries.efficiency.isPending}
        isError={queries.efficiency.isError}
        error={queries.efficiency.error}
      />

      <ProjectSelector
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelect={handleSelect}
        isPending={queries.efficiency.isPending}
      />

      <BranchBreakdown
        data={queries.branches?.data ?? undefined}
        project={selectedProjectId}
        filters={filters}
        isPending={queries.branches?.isPending ?? false}
        isError={queries.branches?.isError ?? false}
        error={queries.branches?.error ?? null}
      />
    </div>
  );
}
