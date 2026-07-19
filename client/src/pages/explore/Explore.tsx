import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { createView } from "../../api/localStore.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { PivotBuilder } from "./PivotBuilder.js";
import { PivotResult } from "./PivotResult.js";
import { SavedViewsGrid } from "./SavedViewsGrid.js";
import { usePivotState } from "./usePivotState.js";

/**
 * Explore page shell (ARCH-explore-page.md §11; specs/claude-lens-pages.md §11).
 * Composes three regions:
 *   1. PivotBuilder — measure/dim/grain/chart/distribution/scatter controls
 *   2. PivotResult  — rendered chart/table based on the current pivot + filters
 *   3. SavedViewsGrid — pinned Explore-origin saved views (third mockup panel)
 *
 * The global FilterBar (date range, project/model/branch/host chips) is
 * mounted once in AppShell and renders above every page, so this shell
 * doesn't render its own.
 *
 * "★ Save view" here is *distinct* from the FilterBar's Save button —
 * FilterBar captures only the global filter keys (range/project/etc.),
 * while this captures the same plus the `xp.*` pivot keys and pins the
 * view to the Dashboard by default (ARCH A3).
 */
export function Explore() {
  const {
    state,
    query,
    setMeasure,
    setDim,
    setGrain,
    setChart,
    setMode,
    setEntity,
    setX,
    setY,
    setSize,
  } = usePivotState();
  const queryClient = useQueryClient();
  const [pathname] = useLocation();
  const search = useSearch();

  const saveMutation = useMutation({
    mutationFn: () => {
      const name = window.prompt("Name this view");
      if (!name || name.trim().length === 0) return Promise.reject(new EmptyNameError());
      return createView({
        name: name.trim(),
        path: pathname,
        search: search ? `?${search}` : "",
        pinned: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.prefixes.views });
    },
  });

  function handleSave(): void {
    if (saveMutation.isPending) return;
    saveMutation.mutate();
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Explore</h1>
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending}
          aria-label="Save this view (pinned to dashboard)"
          data-testid="explore-save-view"
          className={TOGGLE_CLASS}
        >
          ★ Save view
        </button>
      </header>

      <PivotBuilder
        state={state}
        onMeasureChange={setMeasure}
        onDimChange={setDim}
        onGrainChange={setGrain}
        onChartChange={setChart}
        onModeChange={setMode}
        onEntityChange={setEntity}
        onXChange={setX}
        onYChange={setY}
        onSizeChange={setSize}
      />

      <PivotResult query={query} state={state} />

      {saveMutation.isError && !(saveMutation.error instanceof EmptyNameError) && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {(saveMutation.error as Error).message}
        </p>
      )}

      <SavedViewsGrid />
    </div>
  );
}

/** Distinguishes "user cancelled the prompt" from a server error so the
 * page doesn't show a red error banner when the user just hit Escape. */
class EmptyNameError extends Error {
  constructor() {
    super("Save cancelled");
    this.name = "EmptyNameError";
  }
}
