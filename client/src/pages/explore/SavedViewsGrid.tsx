import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { SavedView } from "../../../../shared/local-store-contract.js";
import { deleteView, getViews } from "../../api/localStore.js";
import { qk } from "../../api/queryKeys.js";
import { useMutation } from "@tanstack/react-query";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";

/**
 * Saved-views grid for the Explore page (ARCH-explore-page.md §11). Reads
 * `qk.views()` and renders the subset whose `path === "/explore"` AND
 * `pinned === true` (the contract signal that this view was saved from
 * Explore with intent-to-pin). Clicking a tile navigates to
 * `${path}${search}` which re-applies the saved pivot via the same URL
 * parsing that drives `usePivotState`.
 *
 * Settings page's `SavedViewsTagsPanel` is the management surface
 * (list/delete/rename) for *all* saved views including non-pinned ones
 * — that's why the filter here is Explore-pinned only, not all views.
 */
export function SavedViewsGrid() {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.views(),
    queryFn: ({ signal }) => getViews(signal),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteView(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.prefixes.views }),
  });

  const views = (data ?? []).filter((v) => v.path === "/explore" && v.pinned === true);
  // Sort newest-first so the most recent save is the first card (matches
  // the mockup ordering).
  views.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section
      data-testid="explore-saved-views"
      className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">Saved views</h2>
      {isPending && (
        <p role="status" className="text-xs text-slate-500 dark:text-[#8A96A5]">
          Loading…
        </p>
      )}
      {isError && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {(error as Error).message}
        </p>
      )}
      {!isPending && !isError && views.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-[#8A96A5]">
          No pinned views yet — build a pivot above and click "★ Save view".
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {views.map((view) => (
          <SavedViewTile
            key={view.id}
            view={view}
            onOpen={() => navigate(`${view.path}${view.search}`)}
            onDelete={() => deleteMutation.mutate(view.id)}
          />
        ))}
      </div>
    </section>
  );
}

function SavedViewTile({
  view,
  onOpen,
  onDelete,
}: {
  view: SavedView;
  onOpen(): void;
  onDelete(): void;
}) {
  // The whole card is clickable (open the view). The Delete control is a
  // real nested <button> which is valid HTML inside a div; clicking it
  // stops propagation so the outer click handler doesn't fire.
  return (
    <div className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-3 hover:border-slate-300 dark:border-[#232B36] dark:bg-[#0B0F14] dark:hover:border-[#3A4756]">
      <button
        type="button"
        onClick={onOpen}
        className="-mx-1 -mt-1 cursor-pointer rounded px-1 pt-1 text-left"
      >
        <p className="text-sm font-medium text-slate-900 dark:text-[#E8EDF2]">{view.name}</p>
        <p className="font-mono text-[10px] text-slate-400 dark:text-[#8A96A5]">
          {summarize(view.search)}
        </p>
      </button>
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete saved view ${view.name}`}
          className={TOGGLE_CLASS}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Compact one-line summary of the pivot config encoded in `xp.*` keys —
 * best-effort display only; the canonical state lives in the URL. */
function summarize(search: string): string {
  if (!search) return "default pivot · pinned to dashboard";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const parts: string[] = [];
  const measure = params.get("xp.measure");
  const dim = params.get("xp.dim");
  const chart = params.get("xp.chart");
  const mode = params.get("xp.mode");
  if (measure && dim) parts.push(`${measure} by ${dim}`);
  else if (measure) parts.push(measure);
  if (chart) parts.push(chart);
  if (mode === "distribution") parts.push("distribution");
  return parts.length === 0 ? "default pivot · pinned to dashboard" : parts.join(" · ");
}
