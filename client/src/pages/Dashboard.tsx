import { useQuery } from "@tanstack/react-query";
import type { SeriesMetricsQuery } from "../../../shared/metrics-contract.js";
import { postMetrics } from "../api/metrics.js";
import { qk } from "../api/queryKeys.js";
import { PageStub } from "./PageStub.js";

// Provisional 7-day window — the real range comes from the global filter bar
// (#P3-3). This exists to make the WS invalidation path demonstrable
// end-to-end (ARCH-react-shell.md Open Question) until #P3-4 lands charts.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function smokeQuery(): SeriesMetricsQuery {
  const to = new Date();
  const from = new Date(to.getTime() - SEVEN_DAYS_MS);
  return {
    measures: ["sessions"],
    dimensions: [],
    grain: "day",
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}

export function Dashboard() {
  const query = smokeQuery();
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
