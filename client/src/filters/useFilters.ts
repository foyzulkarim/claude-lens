import { useLocation, useSearch } from "wouter";
import {
  type ChipDimension,
  type FilterRange,
  type FilterState,
  mergeGlobalFilters,
  parseFilters,
} from "./state.js";

export interface UseFiltersResult {
  filters: FilterState;
  setChip(chip: ChipDimension, values: string[]): void;
  setRange(range: FilterRange): void;
  reset(): void;
}

/**
 * Reactive read/write access to the global filter bar's state (architecture
 * §11, decision A1). There is no React state here — `filters` is re-derived
 * from `useSearch()` on every render, and every setter's only job is to
 * `navigate()` to a new query string. Each call is a real history entry
 * (not `replace`), so the browser Back button undoes one filter change at a
 * time (decision A5). Navigating with a bare `to` string (no path) resolves
 * against the current pathname, so the route never changes — only `search`.
 *
 * `commit` patches the global-owned keys onto the existing search string
 * (decision R10 / ARCH A7). Pre-fix, it serialized a fresh `FilterState`
 * and DROPPED every other URL key — a Dashboard drill-in to
 * `/sessions?from=...&to=...&view=page` would silently lose `view=page` the
 * moment the user clicked a chip. Post-fix, `mergeGlobalFilters` replaces
 * only the owned global keys (`range`/`from`/`to`/`project`/`model`/
 * `branch`/`host`) and preserves every Sessions-owned parameter, so
 * browser history and permalinks work as the binding spec requires.
 */
export function useFilters(): UseFiltersResult {
  const search = useSearch();
  const [, navigate] = useLocation();
  const filters = parseFilters(search);

  function commit(next: FilterState): void {
    const merged = mergeGlobalFilters(search, next);
    navigate(merged ? `?${merged}` : "?");
  }

  return {
    filters,
    setChip(chip, values) {
      commit({ ...filters, [chip]: values });
    },
    setRange(range) {
      commit({ ...filters, range });
    },
    reset() {
      // Reset clears ONLY the global keys; page-owned state (e.g. Sessions
      // `view=page`, `sort`, `compare`) survives so a reset never silently
      // breaks the page the user is on.
      commit(parseFilters(""));
    },
  };
}
