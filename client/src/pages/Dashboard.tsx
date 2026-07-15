import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SeriesMetricsQuery } from "../../../shared/metrics-contract.js";
import { postMetrics } from "../api/metrics.js";
import { qk } from "../api/queryKeys.js";
import { filtersToQuery, serializeFilters } from "../filters/state.js";
import { useFilters } from "../filters/useFilters.js";
import { PageStub } from "./PageStub.js";

export function Dashboard() {
  const { filters } = useFilters();
  const filtersKey = serializeFilters(filters);
  // Memoized on filters' serialized shape (its stable primitive identity),
  // not a fresh `new Date()` every render — filtersToQuery resolves presets
  // relative to "now", so recomputing it on every render would change
  // qk.metrics(query)'s hash continuously and refetch in a loop
  // (ARCH-react-shell.md Open Question, same pitfall the old smokeQuery()
  // placeholder called out).
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are [filtersKey] — filtersKey is filters' stable serialized identity, so filters itself is intentionally omitted
  const query = useMemo<SeriesMetricsQuery>(
    () => ({
      measures: ["sessions"],
      dimensions: [],
      grain: "day",
      ...filtersToQuery(filters, new Date()),
    }),
    [filtersKey],
  );
  const { data, isPending, isError, error } = useQuery({
    queryKey: qk.metrics(query),
    queryFn: () => postMetrics(query),
  });

  return (
    <PageStub title="Dashboard">
      {isPending && <p className="mt-4 text-sm text-slate-400">Loading…</p>}
      {isError && <p className="mt-4 text-sm text-red-500">{error.message}</p>}
      {data && (
        <p className="mt-4 text-sm text-slate-500 dark:text-[#5A6675]">
          {data.length} series loaded — live-updates via /ws.
        </p>
      )}
    </PageStub>
  );
}
