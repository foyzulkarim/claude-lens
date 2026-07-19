import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
  Grain,
  Measure,
  Series,
  SeriesMetricsQuery,
} from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { type FilterState, filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useStableNow } from "../dashboard/useStableNow.js";

/**
 * The Models page's single TanStack hook bundle. Mirrors
 * `useCacheLabAnalysis` (Cache Lab's hook): memoizes one query body per
 * section family on the URL's stable filter identity + resolved range
 * + grain + `now` (default `useStableNow` ticking on 60s). The page
 * shell pulls the results and feeds them into seven panels — panel
 * components stay presentational, so Storybook can drive every state
 * with hand-built `data` props.
 *
 * Query count: 7 distinct queries (one per section family the page
 * shell owns). The model-mix-over-time panel fires its own query
 * inside `ModelMixOverTime.tsx` so its local unit toggle drives the
 * right `measure` set without the hook having to know about display
 * prefs. Section-owned loading/empty/error states (ARCH A11) live in
 * each panel — the hook just returns `UseQueryResult<Series[] |
 * undefined>` and the panel picks its own copy.
 */

export interface ModelsQueries {
  filters: FilterState;
  grain: Grain;
  /** Per-model stat row: costComputed + sessions, dimension: model. */
  statRows: UseQueryResult<Series[] | undefined>;
  /** Per-model efficiency ratios: derived client-side from token + cost
   * + turn series keyed on the `model` dimension. */
  efficiency: UseQueryResult<Series[] | undefined>;
  /** Per-version totals (raw semver labels — bucketed client-side via
   * `versionBuckets`). */
  version: UseQueryResult<Series[] | undefined>;
  /** Per-entrypoint totals (cli / ide / sdk). */
  entrypoint: UseQueryResult<Series[] | undefined>;
  /** 🟡 Latency fallback: `wallMinutes ÷ apiCalls` per model. */
  latency: UseQueryResult<Series[] | undefined>;
  /** 🟡 Throughput fallback: `outputTokens ÷ wallMinutes` per model. */
  throughput: UseQueryResult<Series[] | undefined>;
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
  measures: Measure[],
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

export function useModelsQueries(
  filters: FilterState,
  grain: Grain,
  injectedNow?: Date,
): ModelsQueries {
  const now = useStableNow(injectedNow);
  const filtersKey = serializeFilters(filters);
  const args = useQueryArgs(filters, grain, now, filtersKey);

  // Stat row: costComputed + sessions per model (compare: previous-period
  // so the panel can render deltas the same way Dashboard does).
  const statRowsQuery = useMemo<SeriesMetricsQuery>(
    () => makeQuery(["costComputed", "sessions"], ["model"], args, "previous-period"),
    [args],
  );

  // Efficiency table: one query carries every measure the panel needs to
  // derive ratios client-side. Same shape as Dashboard's tokens query —
  // input + output + cacheRead + cacheCreate + costComputed + turns.
  const efficiencyQuery = useMemo<SeriesMetricsQuery>(
    () =>
      makeQuery(
        [
          "inputTokens",
          "outputTokens",
          "cacheReadTokens",
          "cacheCreateTokens",
          "costComputed",
          "turns",
        ],
        ["model"],
        args,
      ),
    [args],
  );

  // Version compare: same measure bundle as efficiency, dimension: version.
  const versionQuery = useMemo<SeriesMetricsQuery>(
    () =>
      makeQuery(
        [
          "inputTokens",
          "outputTokens",
          "cacheReadTokens",
          "cacheCreateTokens",
          "costComputed",
          "turns",
        ],
        ["version"],
        args,
      ),
    [args],
  );

  // Entrypoint breakdown: token flow per client.
  const entrypointQuery = useMemo<SeriesMetricsQuery>(
    () =>
      makeQuery(
        ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreateTokens", "costComputed"],
        ["entrypoint"],
        args,
      ),
    [args],
  );

  // Latency fallback: wallMinutes ÷ apiCalls per model.
  const latencyQuery = useMemo<SeriesMetricsQuery>(
    () => makeQuery(["wallMinutes", "apiCalls"], ["model"], args),
    [args],
  );

  // Throughput fallback: outputTokens ÷ wallMinutes per model.
  const throughputQuery = useMemo<SeriesMetricsQuery>(
    () => makeQuery(["outputTokens", "wallMinutes"], ["model"], args),
    [args],
  );

  const statRows = useQuery({
    queryKey: qk.metrics(statRowsQuery),
    queryFn: ({ signal }) => postMetrics(statRowsQuery, signal),
    placeholderData: keepPreviousData,
  });

  const efficiency = useQuery({
    queryKey: qk.metrics(efficiencyQuery),
    queryFn: ({ signal }) => postMetrics(efficiencyQuery, signal),
    placeholderData: keepPreviousData,
  });

  const version = useQuery({
    queryKey: qk.metrics(versionQuery),
    queryFn: ({ signal }) => postMetrics(versionQuery, signal),
    placeholderData: keepPreviousData,
  });

  const entrypoint = useQuery({
    queryKey: qk.metrics(entrypointQuery),
    queryFn: ({ signal }) => postMetrics(entrypointQuery, signal),
    placeholderData: keepPreviousData,
  });

  const latency = useQuery({
    queryKey: qk.metrics(latencyQuery),
    queryFn: ({ signal }) => postMetrics(latencyQuery, signal),
    placeholderData: keepPreviousData,
  });

  const throughput = useQuery({
    queryKey: qk.metrics(throughputQuery),
    queryFn: ({ signal }) => postMetrics(throughputQuery, signal),
    placeholderData: keepPreviousData,
  });

  return {
    filters,
    grain,
    statRows,
    efficiency,
    version,
    entrypoint,
    latency,
    throughput,
  };
}
