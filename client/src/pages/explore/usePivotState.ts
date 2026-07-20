import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import type { MetricsQuery } from "../../../../shared/metrics-contract.js";
import { filtersToQuery } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "../dashboard/useStableNow.js";
import {
  buildPivotQuery,
  mergePivotState,
  type PivotChart,
  type PivotMode,
  type PivotState,
  parsePivotState,
} from "./state.js";

/**
 * Reactive read/write access to the Explore page's pivot state
 * (ARCH-explore-page.md). Mirrors `useFilters` exactly: no React state,
 * `state` is re-derived from `useSearch()` on every render, every
 * setter's only job is to `navigate()` to a new query string. The pivot
 * `xp.*` keys and the global filter keys (range/project/model/branch/host)
 * coexist in the URL — `mergePivotState` patches only the `xp.*` keys and
 * preserves every other key, so FilterBar chips and pivot toggles never
 * stomp each other.
 *
 * `query` is the pre-built `MetricsQuery` (the discriminated union) ready
 * to pass to `qk.metrics(query)` + `postMetrics` / `postScatterMetrics`
 * depending on `state.chart`.
 *
 * `now` comes from `useStableNow()` so a `range=7d` preset keeps rolling
 * forward every minute (mirrors CacheLab, Models, Sessions, dashboard's
 * `StatCardsRow`). A plain `new Date()` inside the `useMemo` would freeze
 * the range at mount, turning the live "last 7 days" affordance into a
 * load-time snapshot.
 */
export interface UsePivotStateResult {
  state: PivotState;
  query: MetricsQuery;
  setMeasure(measure: PivotState["measure"]): void;
  setDim(dim: PivotState["dim"]): void;
  setGrain(grain: PivotState["grain"]): void;
  setChart(chart: PivotChart): void;
  setMode(mode: PivotMode): void;
  setEntity(entity: PivotState["entity"]): void;
  setX(x: PivotState["x"]): void;
  setY(y: PivotState["y"]): void;
  setSize(size: PivotState["size"] | undefined): void;
  resetPivot(): void;
}

export function usePivotState(): UsePivotStateResult {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { filters } = useFilters();
  const now = useStableNow();

  const state = useMemo(() => parsePivotState(search), [search]);

  const query = useMemo(
    () => buildPivotQuery(state, filtersToQuery(filters, now)),
    [state, filters, now],
  );

  const commit = useCallback(
    (next: PivotState) => {
      const merged = mergePivotState(search, next);
      navigate(merged ? `?${merged}` : "?");
    },
    [search, navigate],
  );

  return {
    state,
    query,
    setMeasure: (measure) => commit({ ...state, measure }),
    setDim: (dim) => commit({ ...state, dim }),
    setGrain: (grain) => commit({ ...state, grain }),
    setChart: (chart) => commit({ ...state, chart }),
    setMode: (mode) => commit({ ...state, mode }),
    setEntity: (entity) => commit({ ...state, entity }),
    setX: (x) => commit({ ...state, x }),
    setY: (y) => commit({ ...state, y }),
    setSize: (size) => commit({ ...state, ...(size ? { size } : {}) }),
    resetPivot: () => commit(parsePivotState("")),
  };
}
