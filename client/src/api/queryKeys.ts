import type { CacheLabQuery } from "../../../shared/cache-lab-contract.js";
import type { MetricsQuery } from "../../../shared/metrics-contract.js";
import type { SessionListParams } from "../../../shared/sessions-contract.js";

/**
 * Single source of truth for TanStack Query keys (architecture §11: "keys
 * from one factory"). ws.ts imports the same prefixes so invalidation can
 * never drift from the keys it targets.
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
  /**
   * Canonical key for one Session Detail resource (#P4-5, T5). Returns
   * `["session", id]` so `queryClient.invalidateQueries({ queryKey: ["session", id] })`
   * matches exactly that detail page, while a wider prefix invalidation
   * (e.g. on socket reconnect) uses `qk.prefixes.session` for every
   * mounted detail query at once.
   */
  session: (id: string) => ["session", id] as const,

  /**
   * Cache Lab key. Lives under the existing `metrics` prefix on purpose
   * (ARCH §A9 / decision A9): the existing WebSocket invalidation bus
   * already targets `qk.prefixes.metrics`, so Cache Lab refreshes on
   * session/scan invalidations without adding a WS message type or
   * prefix. The literal "cache-lab" segment is the second key entry —
   * `qk.metrics(q)` keys do not collide because their first literal
   * segment after the prefix is a MetricsQuery object, not a string.
   */
  cacheLab: (query: CacheLabQuery) => ["metrics", "cache-lab", query] as const,

  prefixes: {
    metrics: ["metrics"] as const,
    session: ["session"] as const,
    sessions: ["sessions"] as const,
  },
};
