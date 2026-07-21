import type { FastifyInstance } from "fastify";
import type { ScanRootConfig } from "../../shared/settings-contract.js";
import type { HealthSnapshot } from "../../shared/health-contract.js";
import type { PipelineStats } from "../pipeline-stats.js";
import type { Store } from "../store/store.js";

// GET /api/health — Data Health surfacing of `parse-premium.ts`'s
// `malformedCount` (review E1 — Critical finding of #P4-13 / #P4-14). The
// store accumulates per-file cumulative malformed-line counts as the
// pipeline parses each premium sidecar (C/B/L); this route exposes the
// rollup so the DataHealth page can render it. No aggregation happens
// here — Store.getHealthSnapshot() returns a pre-computed read-only
// snapshot in O(observed file count).
//
// #P4-14: the route is extended (additively — older callers without
// options still get the legacy four fields) to thread `scanRoots` and
// `pipelineStats` into the snapshot so the §2 scan-coverage and §3
// reconciliation sections have real data. Mirrors how
// `registerMetricsRoute` threads `metadata?.pricing` from `buildApp`.
//
// Mirrors the simple `/api/ping` shape (no body, no validation) — the
// route exists purely to surface the in-memory state.

export interface RegisterHealthRouteOptions {
  /** Active scan roots, surfaced on §2 of the Data Health page. */
  scanRoots?: ScanRootConfig[];
  /** Pipeline-level counters; the route reads them on each request via
   *  the callback so the pipeline owns the runtime state. */
  pipelineStats?: () => PipelineStats;
}

export function registerHealthRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterHealthRouteOptions = {},
): void {
  app.get(
    "/api/health",
    async (): Promise<HealthSnapshot> =>
      store.getHealthSnapshot({
        ...(options.scanRoots ? { scanRoots: options.scanRoots } : {}),
        ...(options.pipelineStats ? { pipelineStats: options.pipelineStats } : {}),
      }),
  );
}
