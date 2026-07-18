import type { MetricsQuery } from "../../../shared/metrics-contract.js";
import type { SessionListParams } from "../../../shared/sessions-contract.js";

/**
 * Single source of truth for TanStack Query keys (architecture §11: "keys
 * from one factory"). ws.ts imports the same prefixes so invalidation can
 * never drift from the keys it targets.
 *
 * Lean by design (ARCH-react-shell.md A3): `metrics` and `sessions` back
 * live endpoints today; `session` is forward-looking for the per-session
 * detail endpoint (#P4-5) and currently invalidates harmlessly since
 * nothing is keyed under it yet beyond the WS router's own invalidation.
 *
 * TanStack's default `hashKey` sorts object keys, so identical values
 * across `metrics(...)` and `sessions(...)` calls dedupe regardless of
 * property order. Array order within the query (e.g. `measures`,
 * `project`) is NOT normalized — callers must pass a canonical order.
 */
export const qk = {
  metrics: (query: MetricsQuery) => ["metrics", query] as const,
  /**
   * Canonical key for `listSessions(params)`. Returns `[qk.prefixes.sessions[0], params]`
   * so `queryClient.invalidateQueries({ queryKey: qk.prefixes.sessions })`
   * matches every page (ARCH T7 invalidation contract). `params` defaults
   * to `{}` so no-args callers produce a stable "all sessions" key without
   * having to remember the empty-object dance.
   */
  sessions: (params: SessionListParams = {}) => ["sessions", params] as const,

  prefixes: {
    metrics: ["metrics"] as const,
    session: (id: string) => ["session", id] as const,
    sessions: ["sessions"] as const,
  },
};
