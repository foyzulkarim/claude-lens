import type { CacheLabQuery } from "../../../shared/cache-lab-contract.js";
import type { MetricsQuery } from "../../../shared/metrics-contract.js";
import type { SessionListParams, SessionPageParams } from "../../../shared/sessions-contract.js";
import type { BiggestLeverParams } from "./scorecard.js";

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
   * Canonical key for one Turn Inspector resource (#P4-6). Returns
   * `["turn-inspector", sessionId, turnNumber]` — a distinct prefix from
   * `qk.session` so a session-scoped invalidation and a turn-scoped one
   * never collide. The session-scoped companion `qk.prefixes.turnInspectorForSession(id)`
   * targets every mounted turn query for that one session (for the
   * `session-updated` socket action), while `qk.prefixes.turnInspector`
   * is a wider invalidation target (socket reconnect, app-wide refresh).
   */
  turnInspector: (sessionId: string, turnNumber: number) =>
    ["turn-inspector", sessionId, turnNumber] as const,

  /**
   * Canonical key for the lazy transcript-peek resource (#P4-6). Kept
   * under its own literal segment so invalidating `qk.prefixes.turnInspector`
   * doesn't also refetch the (expensive, on-demand) raw-file read for every
   * mounted peek panel.
   */
  turnTranscript: (sessionId: string, turnNumber: number) =>
    ["turn-inspector", "transcript", sessionId, turnNumber] as const,

  /**
   * `GET /api/health` key (#P4-14). Bare literal-array key (no params)
   * since the route has no query shape — every mounted Data Health read
   * shares this one cache entry, invalidated wholesale after a session
   * append, a new session, or a scan update. The `health` prefix is its
   * own segment (not under `metrics`) so a metrics-shape change can't
   * accidentally invalidate this read.
   */
  health: () => ["health"] as const,

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

  /**
   * `GET/PUT /api/config` key (#P4-10). A bare literal-array key (no params)
   * since the route has no query shape — every mounted config read shares
   * this one cache entry, invalidated wholesale after a successful `PUT`.
   */
  config: () => ["config"] as const,

  /**
   * `GET /api/capture-assets` key (ARCH-producer-cost-capture-tier). Bare
   * literal-array key — the resolved `capture/` path is fixed at server
   * startup, so one cache entry covers every mounted `CostCaptureGuide`;
   * nothing invalidates it while the server is running.
   */
  captureAssets: () => ["capture-assets"] as const,

  /**
   * `GET /api/version` key. Bare literal-array key — the sidebar's
   * "update available" badge is a single global cache entry, never
   * invalidated (nothing in this session changes the answer).
   */
  version: () => ["version"] as const,

  /** `GET /api/views` key (#P4-15). Bare literal-array key — invalidated wholesale after create/delete. */
  views: () => ["views"] as const,
  /** `GET /api/tags` key (#P4-15). Bare literal-array key — invalidated wholesale after rename/delete/attach. */
  tags: () => ["tags"] as const,

  /**
   * Canonical key for one session's gate report (#P4-11/#P4-12). Lives
   * under its own literal segment so `qk.prefixes.gates` invalidates
   * every mounted Report Card without also nuking the Sessions list
   * (different consumer, different fetch shape).
   */
  gates: (id: string) => ["gates", id] as const,
  /**
   * Dashboard gate-failure feed (#P4-12). Keys on the same query
   * params `fetchWorstGateFailures` sends — query keys must match
   * the request shape so TanStack Query's structural dedupe works
   * (and so refetches invalidate correctly on session-updated).
   */
  gateFailures: (params: Omit<SessionPageParams, "view" | "sort" | "order" | "limit"> = {}) =>
    ["gates", "failures", params] as const,
  /**
   * `GET /api/search-index` key (#P4-3). Bare literal-array key — the
   * entire prompt corpus ships in one response, so a single key covers
   * every mounted search panel. Invalidated wholesale on the
   * `session-prompts-changed` WS message (see ws.ts), not on
   * `session-updated`, so prompt-only mutations don't churn metrics /
   * sessions / detail queries.
   */
  searchIndex: () => ["search-index"] as const,

  /**
   * Canonical key for one session's cache scorecard (ARCH-124, T7). Lives
   * under the shared `"scorecard"` literal segment (with `qk.biggestLever`)
   * so `qk.prefixes.scorecard` invalidates both scorecard surfaces from one
   * WS action, matching R9's "no scorecard data over WS, refetch by prefix"
   * contract.
   */
  scorecard: (sessionId: string) => ["scorecard", "session", sessionId] as const,
  /**
   * Dashboard Biggest Lever key (ARCH-124, T7). Keyed on the same params
   * `getBiggestLever` sends (range + filters) so TanStack Query's
   * structural dedupe/refetch-on-range-change works, mirroring
   * `qk.metrics`/`qk.gateFailures`.
   */
  biggestLever: (params: BiggestLeverParams) => ["scorecard", "biggest-lever", params] as const,

  prefixes: {
    metrics: ["metrics"] as const,
    session: ["session"] as const,
    sessions: ["sessions"] as const,
    config: ["config"] as const,
    views: ["views"] as const,
    tags: ["tags"] as const,
    /**
     * `["gates"]` prefix — invalidates every gate-keyed query (Report
     * Card per session, Dashboard failure feed). The session-updated
     * WS message invalidates this prefix on transcript append, the
     * same way it does for sessions/sessions (review of the prefix
     * shared invalidation pattern in ws.ts).
     */
    gates: ["gates"] as const,
    turnInspector: ["turn-inspector"] as const,
    /** Matches every mounted search panel. Used by ws.ts on `session-prompts-changed`. */
    searchIndex: ["search-index"] as const,
    /**
     * Per-session Turn Inspector prefix. Matches every mounted turn query
     * (`qk.turnInspector(id, n)`) AND the lazy transcript peek
     * (`qk.turnTranscript(id, n)`), because both keys share the leading
     * `["turn-inspector", sessionId]` pair. The 3-tuple peek key
     * `["turn-inspector", "transcript", sessionId, n]` deliberately
     * diverges here — a session-wide invalidation does NOT refetch the
     * on-demand raw-file read, since that cost only makes sense after a
     * user click (see `qk.turnTranscript` rationale above).
     */
    turnInspectorForSession: (sessionId: string) => ["turn-inspector", sessionId] as const,
    /** Matches every mounted Data Health query (#P4-14). The WS handler
     *  emits a `health` invalidation on every `session-updated` /
     *  `session-added` so the page stays fresh during a live transcript
     *  append (which changes dedup/malformed counters). `scan-updated`'s
     *  `all` action already covers it via the same handler. */
    health: ["health"] as const,
    /**
     * Matches both `qk.scorecard(sessionId)` and `qk.biggestLever(params)` —
     * they share the leading `"scorecard"` literal segment (ARCH-124, T7).
     * The `session-updated` WS action invalidates this one prefix so a
     * live-appended session's own Scorecard section AND the fleet-wide
     * Biggest Lever card both refetch (R9).
     */
    scorecard: ["scorecard"] as const,
  },
};
