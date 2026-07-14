import type { MetricsQuery } from "../../../shared/metrics-contract.js";

/**
 * Single source of truth for TanStack Query keys (architecture §11: "keys
 * from one factory"). ws.ts imports the same prefixes so invalidation can
 * never drift from the keys it targets.
 *
 * Lean by design (ARCH-react-shell.md A3): only `metrics` backs a live
 * endpoint today. `session`/`sessions` are forward-looking prefixes for
 * endpoints later phases add (P4-5 session detail, P4-4 sessions list) —
 * they invalidate harmlessly now since nothing is keyed under them yet.
 *
 * TanStack's default `hashKey` sorts object keys, so identical `MetricsQuery`
 * values dedupe regardless of property order. Array order within the query
 * (e.g. `measures`) is NOT normalized — callers must pass a canonical order.
 */
export const qk = {
  metrics: (query: MetricsQuery) => ["metrics", query] as const,

  prefixes: {
    metrics: ["metrics"] as const,
    session: (id: string) => ["session", id] as const,
    sessions: ["sessions"] as const,
  },
};
