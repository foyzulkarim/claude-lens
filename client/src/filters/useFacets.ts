import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SeriesMetricsQuery } from "../../../shared/metrics-contract.js";
import { postMetrics } from "../api/metrics.js";
import { qk } from "../api/queryKeys.js";
import { CHIP_DIMENSION, type ChipDimension, type FilterRange, resolveRange } from "./state.js";

export interface UseFacetsResult {
  options: string[];
  isPending: boolean;
  isError: boolean;
}

function rangeCacheKey(range: FilterRange): string {
  return "preset" in range ? range.preset : `${range.from}|${range.to}`;
}

/**
 * Chip option values, sourced from the metrics engine rather than a
 * dedicated facets endpoint (decision A2, no server surface added): a
 * single-dimension breakdown query returns one `Series` per distinct value,
 * and its `label` is the option text. `enabled` gates the fetch to only
 * fire once a chip dropdown is opened (R6 — lazy, not on every page load);
 * TanStack Query then caches it by the same `qk.metrics` key every other
 * query uses, so reopening is free.
 *
 * The query's `now` anchor is memoized by a primitive cache key (not the
 * `range` object's identity, which changes every render since it's
 * re-parsed from the URL) — otherwise the query key would drift by
 * milliseconds on every render and refetch continuously.
 */
export function useFacets(
  dim: ChipDimension,
  range: FilterRange,
  enabled: boolean,
): UseFacetsResult {
  const cacheKey = rangeCacheKey(range);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are [dim, cacheKey] — cacheKey is range's stable primitive identity, so range itself is intentionally omitted
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["sessions"],
      dimensions: [CHIP_DIMENSION[dim]],
      grain: "day",
      range: resolveRange(range, new Date()),
    }),
    [dim, cacheKey],
  );

  const { data, isPending, isError } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: () => postMetrics(query),
    enabled,
  });

  return {
    options: data?.map((series) => series.label) ?? [],
    isPending,
    isError,
  };
}
