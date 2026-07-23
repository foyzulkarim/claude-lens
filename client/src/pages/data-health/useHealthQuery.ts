import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type { HealthSnapshot } from "../../../../shared/health-contract.js";
import { fetchHealth } from "../../api/health.js";
import { qk } from "../../api/queryKeys.js";

/**
 * The Data Health page's single TanStack Query (#P4-14). The page is
 * driven by one `HealthSnapshot` GET — every section panel is a pure
 * derivation of that response, so the hook bundle is a single query,
 * not a multiplexer. The WS handler invalidates `qk.prefixes.health`
 * on every `session-added` / `session-updated` (see `client/ws.ts`),
 * so a live page refetches within `staleTime` of any change that
 * shifts a fleet count.
 *
 * `staleTime: 30_000` — the snapshot is O(sessions) per request
 * (architecture §8: "expensive to recompute, fine to cache briefly").
 * 30s keeps a mounted page from refetching on every interaction while
 * still feeling live; WS invalidation re-fires the query immediately
 * when the underlying state shifts.
 *
 * `enabled` controls whether the query fires (review TC-5 / RP-1).
 * When the DataHealth page is rendered with an injected `snapshot`
 * prop (Storybook stories, tests) the query is suppressed so the
 * fetch doesn't run — and, critically, so the page doesn't crash
 * with "No QueryClient set" when there's no provider in the tree.
 */
export function useHealthQuery(options?: { enabled?: boolean }): UseQueryResult<HealthSnapshot> {
  return useQuery({
    queryKey: qk.health(),
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}
