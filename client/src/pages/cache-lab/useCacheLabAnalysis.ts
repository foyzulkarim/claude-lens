import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { CacheLabQuery } from "../../../../shared/cache-lab-contract.js";
import type { Grain } from "../../../../shared/metrics-contract.js";
import { postCacheLab } from "../../api/cacheLab.js";
import { qk } from "../../api/queryKeys.js";
import { type FilterState, filtersToQuery } from "../../filters/state.js";

const DEFAULT_REFRESH_MS = 60_000;

/**
 * A `now` that stays referentially stable across renders while still
 * ticking on its own — mirrors Dashboard's `useStableNow` so the Cache
 * Lab hook produces one cache entry per (filters, grain, now-bucket)
 * instead of a fresh refetch on every render. Inlined here (rather
 * than importing the Dashboard copy) to keep this hook free of a
 * cross-page import while the page composition lands.
 */
function useStableNow(injectedNow?: Date, refreshMs = DEFAULT_REFRESH_MS): Date {
  const [now, setNow] = useState(() => injectedNow ?? new Date());

  useEffect(() => {
    if (injectedNow !== undefined) {
      setNow(injectedNow);
      return;
    }
    const id = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(id);
  }, [injectedNow, refreshMs]);

  return now;
}

/**
 * The single TanStack hook every Cache Lab panel reads. Shares one
 * fetch across all mounted consumers (decision A11 — section-owned
 * states still share the analysis payload via TanStack's cache) so
 * Cache Lab makes one /api/cache-lab POST per (filters, grain, now)
 * tuple even when six components render.
 *
 * Memoizes the query body on the URL's stable filter identity +
 * resolved range + grain + `now` (default `useStableNow` ticking on
 * 60s). TanStack's default `hashKey` handles the object identity
 * dedupe; the memo just prevents a fresh query object on every
 * unrelated render.
 */
export function useCacheLabAnalysis(filters: FilterState, grain: Grain, injectedNow?: Date) {
  const now = useStableNow(injectedNow);
  const query = useMemo<CacheLabQuery>(() => {
    const { range, filters: chipFilters } = filtersToQuery(filters, now) as {
      range: { from: string; to: string };
      filters?: CacheLabQuery["filters"];
    };
    return {
      range,
      grain,
      ...(chipFilters !== undefined ? { filters: chipFilters as CacheLabQuery["filters"] } : {}),
    } as CacheLabQuery;
  }, [filters, grain, now]);

  return useQuery({
    queryKey: qk.cacheLab(query),
    queryFn: ({ signal }) => postCacheLab(query, signal),
  });
}
