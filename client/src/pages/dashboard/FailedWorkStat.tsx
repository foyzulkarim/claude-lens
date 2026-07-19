import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { pointValueOrNull } from "../../charts/series-math.js";
import { formatUnitValueOrDash } from "../../charts/units.js";
import { StatCard } from "../../components/StatCard.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";
import { useStableNow } from "./useStableNow.js";

/**
 * Reads the `toolErrors` aggregate out of the metrics response, preserving
 * the distinction the server-side measure makes on purpose
 * (server/metrics/measures.ts: `toolErrors` returns `null` — not `0` — when
 * a scope has no turns at all, i.e. genuinely no data, vs. `0` when turns
 * exist but none carry a classified failure). Exported so the "renders `0`
 * vs `undefined` distinctly" Testable Seam (T11 spec) is unit-testable
 * without a component render. Review #6: null-safe extraction now comes
 * from the shared `pointValueOrNull` helper rather than a hand-rolled guard.
 */
export function failedWorkCount(series: Series[] | undefined): number | null {
  return pointValueOrNull(series?.find((s) => s.measure === "toolErrors")?.points[0]);
}

/** Formats the failed-work count: a real zero renders "0" (A3+R3 — zero
 * failures is a genuine fact, not "no data"); `null` (no turns in scope at
 * all) renders "—". Review #6: reuses the shared `formatUnitValueOrDash`
 * formatting helper. */
export function formatFailedWorkCount(count: number | null): string {
  return formatUnitValueOrDash(count, "calls");
}

/**
 * Dashboard "failed work" counter (architecture §"Failed-work stat", T11):
 * a single unioned count of classified error tool_results / failed commands
 * (`toolErrors` measure, T3a) over the active filters and date range — does
 * NOT split into separate categories per the T11 scope boundary.
 */
export interface FailedWorkStatProps {
  /** Injection seam for stories/tests; defaults to the real current time. */
  now?: Date;
}

export function FailedWorkStat({ now: injectedNow }: FailedWorkStatProps = {}) {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // Review #4: same stale-closure bug class as the live-window cards fixed
  // in PR #89's two follow-up commits. `new Date()` here froze the
  // failed-work window to mount time.
  const now = useStableNow(injectedNow);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey); now ticks on its own via useStableNow
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["toolErrors"],
      dimensions: [],
      grain: "day",
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const count = failedWorkCount(data);
  const value = isPending ? "…" : formatFailedWorkCount(count);
  const sub = isError
    ? (error?.message ?? "unavailable")
    : "classified error tool results + failed commands";

  return <StatCard label="Failed work" value={value} sub={sub} />;
}
