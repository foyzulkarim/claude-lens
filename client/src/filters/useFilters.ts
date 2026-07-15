import { useLocation, useSearch } from "wouter";
import { type FilterRange, type FilterState, parseFilters, serializeFilters } from "./state.js";

export type Chip = "project" | "model" | "branch" | "host";

export interface UseFiltersResult {
  filters: FilterState;
  setChip(chip: Chip, values: string[]): void;
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
 */
export function useFilters(): UseFiltersResult {
  const search = useSearch();
  const [, navigate] = useLocation();
  const filters = parseFilters(search);

  function commit(next: FilterState): void {
    const serialized = serializeFilters(next);
    navigate(serialized ? `?${serialized}` : "?");
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
      commit(parseFilters(""));
    },
  };
}
