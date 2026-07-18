import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Series, SeriesMetricsQuery } from "../../../../shared/metrics-contract.js";
import { postMetrics } from "../../api/metrics.js";
import { qk } from "../../api/queryKeys.js";
import { formatUnitValue } from "../../charts/units.js";
import { filtersToQuery, serializeFilters } from "../../filters/state.js";
import { useFilters } from "../../filters/useFilters.js";

/**
 * The two Dashboard "savings" measures landed in T3a. Breaking down by
 * `model` (rather than aggregating with `dimensions: []`) is the whole
 * point: `computeMeasure` (server/metrics/measures.ts) poisons an entire
 * bucket's result to `null` the moment ANY call inside it is unpriced, so a
 * single unaggregated bucket containing one unknown-model call would wipe
 * out every priced call's real savings too. Grouping by model means each
 * group's calls share one model — an unpriced model's group comes back
 * `null` and is dropped, while every priced model's group still contributes
 * its real number (per T12's "unknown model contributes no fabricated
 * savings" checklist item).
 */
function buildQuery(
  filters: ReturnType<typeof useFilters>["filters"],
  now: Date,
): SeriesMetricsQuery {
  return {
    measures: ["cacheSavingsComputed", "routingSavingsComputed"],
    dimensions: ["model"],
    grain: "day",
    ...filtersToQuery(filters, now),
  };
}

export interface SavingsTotals {
  cache: number;
  routing: number;
  total: number;
}

/** Finite, non-null point values only — a `null` group (unpriced model, per
 * the poisoning behavior above) is silently dropped rather than treated as
 * $0 or propagated as `NaN`. */
function sumMeasure(data: Series[], measure: Series["measure"]): number {
  return data
    .filter((series) => series.measure === measure)
    .reduce((sum, series) => {
      const value = series.points[0]?.value;
      return typeof value === "number" && Number.isFinite(value) ? sum + value : sum;
    }, 0);
}

/**
 * Sums the two T3a measures into the stacked totals this section renders.
 * `undefined` means "no data yet" (still loading); a resolved-but-empty or
 * all-null `Series[]` legitimately totals to real zeros, never `undefined`
 * — the "zero savings is a real zero" checklist item.
 */
export function computeSavingsTotals(data: Series[] | undefined): SavingsTotals | undefined {
  if (!data) return undefined;
  const cache = sumMeasure(data, "cacheSavingsComputed");
  const routing = sumMeasure(data, "routingSavingsComputed");
  return { cache, routing, total: cache + routing };
}

interface SegmentProps {
  label: string;
  value: number;
  maxValue: number;
}

function Segment({ label, value, maxValue }: SegmentProps) {
  const widthPct = maxValue > 0 ? Math.max(0, Math.min(100, (value / maxValue) * 100)) : 0;
  return (
    <div className="grid grid-cols-[110px_1fr_70px] items-center gap-2 text-sm">
      <span className="text-slate-600 dark:text-[#8A96A5]">{label}</span>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-[#1B222B]">
        <div
          className="h-2 rounded-full bg-emerald-500 dark:bg-emerald-400"
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="text-right font-mono text-slate-900 dark:text-[#E8EDF2]">
        {formatUnitValue(value, "$")}
      </span>
    </div>
  );
}

/**
 * Dashboard section (ARCH-dashboard-page.md T12): two stacked savings
 * segments — cache discount and cheap-model routing — that sum exactly to
 * the all-Opus-uncached counterfactual (`cacheSavingsComputed +
 * routingSavingsComputed == costAtOpusUncached - actualCost`, decision A8,
 * enforced server-side in T3a). This component's only job is to fetch the
 * two measures and add them up correctly — no client-side re-derivation of
 * the savings algebra, which is exactly the double-counting failure mode
 * the spec calls out as high-risk.
 */
export function SavingsDecomposition() {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters is covered by its stable serialized identity (filtersKey)
  const query = useMemo<SeriesMetricsQuery>(() => buildQuery(filters, new Date()), [filtersKey]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: ({ signal }) => postMetrics(query, signal),
    placeholderData: keepPreviousData,
  });

  const totals = useMemo(() => computeSavingsTotals(data), [data]);
  const maxSegment = totals ? Math.max(totals.cache, totals.routing) : 0;

  return (
    <div
      data-testid="savings-decomposition"
      className="rounded-md border border-slate-200 bg-white p-4 dark:border-[#232B36] dark:bg-[#151A21]"
    >
      <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E8EDF2]">
        What you didn't pay
      </h2>

      <div className="mt-3">
        {isPending && (
          <p role="status" className="text-sm text-slate-500 dark:text-[#8B98A9]">
            Loading…
          </p>
        )}
        {isError && (
          <p role="alert" className="text-sm text-[#B23A3A] dark:text-[#E05252]">
            {error.message}
          </p>
        )}
        {!isPending && !isError && totals && (
          <div className="flex flex-col gap-2">
            <Segment label="cache discount" value={totals.cache} maxValue={maxSegment} />
            <Segment label="cheap-model routing" value={totals.routing} maxValue={maxSegment} />
            <p
              data-testid="savings-total"
              className="mt-1 font-mono text-xs text-slate-500 dark:text-[#5A6675]"
            >
              {formatUnitValue(totals.total, "$")} total
            </p>
          </div>
        )}
      </div>

      <p className="mt-2 font-mono text-xs text-slate-400 dark:text-[#5A6675]">
        vs all-Opus, uncached counterfactual
      </p>
    </div>
  );
}
