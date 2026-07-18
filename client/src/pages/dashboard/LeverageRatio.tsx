import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { StatCard } from "../../components/StatCard.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";

const RATIO_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Reads a single-point aggregate measure out of the metrics response
 * (`dimensions: []` queries collapse to one point per measure — engine.ts's
 * `computeSeriesForRange`). `null`/non-finite points (measure unavailable,
 * e.g. an empty scope) are treated as "no value", never coerced to 0. */
function aggregateValue(series: Series[] | undefined, measure: string): number | null {
  const point = series?.find((s) => s.measure === measure)?.points[0];
  return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null;
}

/**
 * Cache-read tokens ÷ fresh-billed (input + cache-create) tokens — the pure
 * arithmetic core, exported so the denominator=0/null edge cases (Testable
 * Seam, T11 spec) are unit-testable without a component render. Mirrors the
 * same eligible-denominator guard `cacheHitPct` uses server-side
 * (server/metrics/measures.ts) rather than inventing a new one: a
 * zero or unavailable denominator returns `null` ("unavailable"), never
 * `NaN`/`Infinity`.
 */
export function computeLeverageRatio(
  cacheReadTokens: number | null,
  inputTokens: number | null,
  cacheCreateTokens: number | null,
): number | null {
  if (inputTokens === null || cacheCreateTokens === null || cacheReadTokens === null) return null;
  const freshBilled = inputTokens + cacheCreateTokens;
  return freshBilled > 0 ? cacheReadTokens / freshBilled : null;
}

/** Formats a leverage ratio as "Nx" with exactly one decimal place, or "—"
 * when the ratio is unavailable (A3+R3: unavailable, never NaN/Infinity). */
export function formatLeverageRatio(ratio: number | null): string {
  return ratio === null ? "—" : `${RATIO_FORMAT.format(ratio)}×`;
}

/**
 * Dashboard headline stat (architecture §"Leverage ratio", T11): aggregate
 * cache-read tokens divided by fresh-billed input/cache-create tokens over
 * the active filters and date range — same query shape as the other
 * filter-aware sections (`filtersToQuery`), unlike `RecordsStrip` which
 * overrides the date range per A7.
 */
export function LeverageRatio() {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["cacheReadTokens", "inputTokens", "cacheCreateTokens"],
      dimensions: [],
      grain: "day",
      ...filtersToQuery(filters, new Date()),
    }),
    [filtersKey],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const ratio = computeLeverageRatio(
    aggregateValue(data, "cacheReadTokens"),
    aggregateValue(data, "inputTokens"),
    aggregateValue(data, "cacheCreateTokens"),
  );

  const value = isPending ? "…" : formatLeverageRatio(ratio);
  const sub = isError ? (error?.message ?? "unavailable") : "served from cache ÷ fresh-billed";

  return <StatCard label="Cache leverage" value={value} accent="cache" sub={sub} />;
}
