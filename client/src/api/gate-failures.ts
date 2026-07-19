import type { SessionPageItem, SessionPageParams } from "../../../shared/sessions-contract.js";
import { listSessionsPage } from "./sessions.js";

/**
 * Dashboard gate-failure feed (#P4-12, ARCH-p4-12 §Cross-Cutting).
 *
 * Not a new HTTP endpoint — the Sessions page projection (`view=page`)
 * already accepts `sort=gateScore&order=asc` (declared in
 * `client/src/pages/sessions/state.ts:124`), and the row projector now
 * populates `gateScore`/`gateStatus` from the cache (T4). Reusing
 * `listSessionsPage` keeps the wire + cache + invalidation story one-
 * track: the AnomalyFeed's `gateFailure` items are simply the top-N
 * Sessions rows by worst gate score.
 *
 * The Dashboard's existing list calls sort by `costComputed` desc; this
 * wrapper sidesteps that by always forcing `sort=gateScore&order=asc`
 * regardless of caller input. The AnomalyFeed is the only consumer
 * today, so a plain purpose-built helper is clearer than overloading
 * the existing Dashboard sort.
 *
 * Returns only the rows that have a `gateScore` populated — sessions
 * the cache hasn't evaluated yet (cold cache, fresh ingest) are
 * naturally absent, which matches the AnomalyFeed's existing "no items"
 * empty state.
 */
const DASHBOARD_GATE_FAILURES_LIMIT = 5;

export async function fetchWorstGateFailures(
  params: Omit<SessionPageParams, "view" | "sort" | "order" | "limit"> = {},
  signal?: AbortSignal,
): Promise<SessionPageItem[]> {
  const response = await listSessionsPage(
    {
      ...params,
      sort: "gateScore",
      order: "asc",
      limit: DASHBOARD_GATE_FAILURES_LIMIT,
    },
    signal,
  );
  return response.items.filter((item) => item.gateScore !== undefined);
}
