import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SeriesMetricsQuery } from "../../../shared/metrics-contract.js";
import { postMetrics } from "../api/metrics.js";
import { qk } from "../api/queryKeys.js";
import { filtersToQuery, serializeFilters } from "../filters/state.js";
import { useFilters } from "../filters/useFilters.js";
import { BaselineWeightPanel } from "./cache-lab/BaselineWeightPanel.js";
import { BustEconomicsPanel } from "./cache-lab/BustEconomicsPanel.js";
import { ContextGrowthPanel } from "./cache-lab/ContextGrowthPanel.js";
import { FleetOverview } from "./cache-lab/FleetOverview.js";
import { HitRatePanel } from "./cache-lab/HitRatePanel.js";
import { InvalidationCostPanel } from "./cache-lab/InvalidationCostPanel.js";
import { InvalidationGallery } from "./cache-lab/InvalidationGallery.js";
import { MissAttributionPanel } from "./cache-lab/MissAttributionPanel.js";
import { TtlMixPanel } from "./cache-lab/TtlMixPanel.js";
import { useCacheLabAnalysis } from "./cache-lab/useCacheLabAnalysis.js";
import { useStableNow } from "./dashboard/useStableNow.js";

const GRAIN = "day";

/**
 * Cache Lab page shell (ARCH §T8): composes every binding §7 section
 * in the spec's order — overview → bust/attribution/TTL diagnostics →
 * hit rate → baseline → invalidation cost → gallery → context growth.
 * Each section owns its own loading / empty / error states per
 * decision A11, so a Cache Lab endpoint outage renders local alerts
 * while the metrics-backed hit-rate panel keeps working.
 *
 * Hit-rate data flows through `/api/metrics` (decision A1) so the
 * overview card and the chart remain usable even when the dedicated
 * endpoint is down.
 */
export function CacheLab() {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  const now = useStableNow();

  // biome-ignore lint/correctness/useExhaustiveDependencies: filters covered by stable filtersKey serialization
  const metricsQuery = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["cacheHitPct"],
      dimensions: ["time"],
      grain: GRAIN,
      ...filtersToQuery(filters, now),
    }),
    [filtersKey, now],
  );
  const hitRateQuery = useQuery({
    queryKey: qk.metrics(metricsQuery),
    queryFn: ({ signal }) => postMetrics(metricsQuery, signal),
    placeholderData: keepPreviousData,
  });

  // One analysis hook powers every cache-lab panel; TanStack dedupes
  // identical consumers so this single fetch serves all sections.
  const cacheLabQuery = useCacheLabAnalysis(filters, GRAIN);
  const analysis = cacheLabQuery.data;

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Cache Lab</h1>

      {cacheLabQuery.isError && (
        <div
          role="alert"
          className="rounded-md border border-[#B23A3A] bg-[#FDF4E3] p-4 text-sm text-[#B23A3A] dark:border-[#E05252] dark:bg-[#3A2C18] dark:text-[#E05252]"
        >
          Cache Lab analysis failed: {cacheLabQuery.error.message}
        </div>
      )}

      <FleetOverview hitRateSeries={hitRateQuery.data} cacheLab={analysis} />

      <HitRatePanel series={hitRateQuery.data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BustEconomicsPanel data={analysis} error={cacheLabQuery.error} />
        <MissAttributionPanel data={analysis} error={cacheLabQuery.error} />
        <TtlMixPanel data={analysis} error={cacheLabQuery.error} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BaselineWeightPanel points={analysis?.baseline.points} error={cacheLabQuery.error} />
      </div>

      <InvalidationGallery data={analysis} error={cacheLabQuery.error} />
      <InvalidationCostPanel
        points={analysis?.invalidationCost.points}
        error={cacheLabQuery.error}
      />
      <ContextGrowthPanel data={analysis?.contextGrowth} error={cacheLabQuery.error} />
    </div>
  );
}
