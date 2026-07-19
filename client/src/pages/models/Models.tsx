import type { Grain } from "../../../../shared/metrics-contract.js";
import { useFilters } from "../../filters/useFilters.js";
import { EfficiencyTable } from "./EfficiencyTable.js";
import { EntrypointBreakdown } from "./EntrypointBreakdown.js";
import { LatencyByModel } from "./LatencyByModel.js";
import { LockedLinesPerCost } from "./LockedLinesPerCost.js";
import { ModelMixOverTime } from "./ModelMixOverTime.js";
import { ModelStatsRow } from "./ModelStatsRow.js";
import { ThroughputByModel } from "./ThroughputByModel.js";
import { VersionBeforeAfter } from "./VersionBeforeAfter.js";
import { useModelsQueries } from "./useModelsQueries.js";

const GRAIN: Grain = "day";

/**
 * Models page shell (ARCH §6, Models): composes every binding §6 section
 * in the spec's order — spend stat row → model mix over time → efficiency
 * table + CC-version compare → 🟡 latency + 🟡 throughput → 🔒
 * $/1k-lines → entrypoint breakdown. Each section owns its own loading /
 * empty / error states (A11), so a single failure can't blank the page.
 *
 * The model-mix-over-time panel owns its own unit toggle (local state
 * per ARCH A7), and fires its own `SeriesMetricsQuery` against
 * `/api/metrics` directly — the page-level hook bundle skips that
 * query so the hook stays a coordinator, not a multiplexer.
 *
 * Hook coverage (one query per section family):
 *   • ModelStatsRow       — statRows
 *   • EfficiencyTable     — efficiency
 *   • VersionBeforeAfter  — version
 *   • LatencyByModel      — latency
 *   • ThroughputByModel   — throughput
 *   • EntrypointBreakdown — entrypoint
 *
 * No `modelMix` query on the hook: ModelMixOverTime builds its own
 * inside the panel so its local unit state can drive the right
 * measures without the hook knowing about display prefs.
 */
export function Models() {
  const { filters } = useFilters();
  const queries = useModelsQueries(filters, GRAIN);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-[#E8EDF2]">Models</h1>

      <ModelStatsRow
        data={queries.statRows.data}
        filters={filters}
        isPending={queries.statRows.isPending}
        isError={queries.statRows.isError}
        error={queries.statRows.error}
      />

      <ModelMixOverTime filters={filters} grain={GRAIN} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EfficiencyTable
          data={queries.efficiency.data}
          filters={filters}
          isPending={queries.efficiency.isPending}
          isError={queries.efficiency.isError}
          error={queries.efficiency.error}
        />
        <VersionBeforeAfter
          data={queries.version.data}
          isPending={queries.version.isPending}
          isError={queries.version.isError}
          error={queries.version.error}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LatencyByModel
          data={queries.latency.data}
          filters={filters}
          isPending={queries.latency.isPending}
          isError={queries.latency.isError}
          error={queries.latency.error}
        />
        <ThroughputByModel
          data={queries.throughput.data}
          filters={filters}
          isPending={queries.throughput.isPending}
          isError={queries.throughput.isError}
          error={queries.throughput.error}
        />
      </div>

      <LockedLinesPerCost />

      <EntrypointBreakdown
        data={queries.entrypoint.data}
        filters={filters}
        isPending={queries.entrypoint.isPending}
        isError={queries.entrypoint.isError}
        error={queries.entrypoint.error}
      />
    </div>
  );
}
