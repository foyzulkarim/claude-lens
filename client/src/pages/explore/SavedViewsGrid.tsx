import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useLocation } from "wouter";
import type { SavedView } from "../../../../shared/local-store-contract.js";
import { deleteView, getViews } from "../../api/localStore.js";
import { qk } from "../../api/queryKeys.js";
import { TOGGLE_CLASS } from "../../ui/toggleStyles.js";
import { PIVOT_KEY_PREFIX } from "./state.js";

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

  // Stable refs to every tile's Open button — `SavedViewTile` writes its
  // button ref into the map below, so after a Delete we can move focus to
  // the surviving neighbour (next tile, falling back to previous) instead
  // of leaving the keyboard user stranded on `<body>` (WCAG 2.4.3).
  const tileRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteView(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: qk.prefixes.views });
      // Move focus to the next tile's Open button. The deleted view is
      // already gone from the cached list (`getQueryData` returns the
      // post-mutation cache because `invalidateQueries` is synchronous
      // on the cached snapshot), so the first surviving tile visually
      // occupies the deleted tile's slot when the deleted view was at
      // the head. Defer one frame so React has unmounted the deleted
      // tile before we look up the surviving neighbour's ref.
      const survivingIds = (queryClient.getQueryData<SavedView[]>(qk.views()) ?? [])
        .filter((v) => v.path === "/explore" && v.pinned === true && v.id !== id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const fallback = tileRefs.current.get(survivingIds[0]?.id ?? "") ?? null;
      requestAnimationFrame(() => {
        fallback?.focus();
      });
    },
  });

  const views = (data ?? []).filter((v) => v.path === "/explore" && v.pinned === true);
  // Sort newest-first so the most recent save is the first card (matches
  // the mockup ordering). Copy first so we don't mutate the cached array.
  const sortedViews = [...views].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
          {error instanceof Error ? error.message : "Failed to load saved views"}
        </p>
      )}
      {!isPending && !isError && sortedViews.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-[#8A96A5]">
          No pinned views yet — build a pivot above and click <span aria-hidden="true">★</span> Save
          view.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sortedViews.map((view) => (
          <SavedViewTile
            key={view.id}
            view={view}
            registerOpenButton={(el) => {
              if (el) tileRefs.current.set(view.id, el);
              else tileRefs.current.delete(view.id);
            }}
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
  registerOpenButton,
}: {
  view: SavedView;
  onOpen(): void;
  onDelete(): void;
  registerOpenButton(el: HTMLButtonElement | null): void;
}) {
  // The whole card is clickable (open the view). The Delete control is a
  // real sibling <button>; clicking it does NOT bubble through to the
  // Open handler because Open sits on its own button element.
  return (
    <div className="flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 p-3 hover:border-slate-300 dark:border-[#232B36] dark:bg-[#0B0F14] dark:hover:border-[#3A4756]">
      <button
        type="button"
        ref={registerOpenButton}
        onClick={onOpen}
        className="-mx-1 -mt-1 cursor-pointer rounded px-1 pt-1 text-left focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        <p className="text-sm font-medium text-slate-900 dark:text-[#E8EDF2]">{view.name}</p>
        <p className="font-mono text-[10px] text-slate-500 dark:text-[#8A96A5]">
          {summarizePivotSearch(view.search)}
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
export function summarizePivotSearch(search: string): string {
  if (!search) return "default pivot · pinned to dashboard";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const parts: string[] = [];
  const measure = params.get(`${PIVOT_KEY_PREFIX}measure`);
  const dim = params.get(`${PIVOT_KEY_PREFIX}dim`);
  const chart = params.get(`${PIVOT_KEY_PREFIX}chart`);
  const mode = params.get(`${PIVOT_KEY_PREFIX}mode`);
  if (measure && dim) parts.push(`${measure} by ${dim}`);
  else if (measure) parts.push(measure);
  if (chart) parts.push(chart);
  if (mode === "distribution") parts.push("distribution");
  return parts.length === 0 ? "default pivot · pinned to dashboard" : parts.join(" · ");
}
