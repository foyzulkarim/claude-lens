/**
 * Sessions-list wire contract. Defines the query vocabulary, list item shape,
 * and response metadata for the dashboard sessions API.
 *
 * Two projections live here side-by-side:
 *  - The compact `SessionListResponse` powers the Dashboard. Its sort/filter
 *    union is intentionally narrow — adding every page-level literal here
 *    would break the existing Dashboard tests (#P4-2 review).
 *  - The strict `SessionPageResponse` powers the Sessions page (#P4-4, ARCH
 *    #36). Its view=page projection is opt-in via `?view=page`, keeps the
 *    summary shape untouched, and exposes the wider sort/filter/session-
 *    population vocabulary the page needs.
 */

import type { TierFlags } from "./types.js";

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

/**
 * Compact Dashboard projection — sort/filter union deliberately narrow so
 * the existing Dashboard tests (#P4-2) stay valid. The Sessions page uses
 * `SessionPageParams` instead.
 */
export interface SessionListParams {
  sort?: "lastAt" | "costComputed" | "durationMs" | "cacheSavingsComputed" | "maxTurnCostComputed";
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
  from?: string; // ISO date
  to?: string;
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
  include?: "trace";
}

/**
 * Wider sort union the Sessions page supports (#P4-4 / ARCH T2). Adds
 * tier-dependent and observation-only fields the compact Dashboard shape
 * doesn't expose; the route validates `view=page` queries against this
 * wider union and `view=summary` (the default) against `SessionListParams`.
 */
export type SessionPageSortKey =
  | "lastAt"
  | "costComputed"
  | "costObserved"
  | "durationMs"
  | "totalTokens"
  | "turnCount"
  | "cacheHitPct"
  | "cacheSavingsComputed"
  | "maxTurnCostComputed"
  | "gateScore"
  | "branch"
  | "version";

/**
 * The canonical, server-internal description of which sessions participate
 * in a Sessions-page section (architecture §9 + ARCH-sessions-page.md A2).
 * Both `server/routes/sessions.ts` (table/timeline/compare projection) and
 * `server/metrics/{engine,scatter,distribution}.ts` (aggregate metrics)
 * normalize their inputs into this model, so range/categorical/cost/drilldown
 * semantics never drift between sections.
 *
 * `gateStatus` is reserved — present in the type for forward compatibility
 * with #P4-12, but the page does not yet emit a `gateStatus` filter (no
 * upstream source populates it). Treating it as an unavailable filter
 * today is the established "explicit seam" pattern from R8/A11.
 */
export interface SessionPopulationFilter {
  range: { from: string; to: string };
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
  entrypoint?: string[];
  minCostComputed?: number;
  maxCostComputed?: number;
  /** Reserved for #P4-12 — the page does not yet emit this filter. */
  gateStatus?: string[];
  /** `true` ↔ `turnCount > 0` (R9). */
  hasDrilldown?: boolean;
  /**
   * Comparison hydration only. The list endpoint ignores this filter; the
   * compare panel uses it to restrict which session IDs hydrate under the
   * active population rules. Capped at 3 by the server validator.
   */
  sessionId?: string[];
}

/**
 * The metrics-query variant of `SessionPopulationFilter` — same shape but
 * without a range, since `MetricsQuery` already carries the top-level range
 * (architecture §8) and unifying them would let two competing ranges drift.
 */
export type SessionPopulationCriteria = Omit<SessionPopulationFilter, "range">;

export interface SessionPageParams {
  /** Required to disambiguate from the existing summary projection. */
  view: "page";
  sort?: SessionPageSortKey;
  order?: "asc" | "desc";
  offset?: number;
  limit?: number;
  from?: string;
  to?: string;
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
  entrypoint?: string[];
  minCostComputed?: number;
  maxCostComputed?: number;
  /** Reserved for #P4-12 — the page does not yet emit this. */
  gateStatus?: string[];
  hasDrilldown?: boolean;
  /** Optional timeline projection attached to the same response. */
  include?: "timeline";
  /** Comparison hydration only — max 3 IDs (server-validated). */
  sessionId?: string[];
}

// ---------------------------------------------------------------------------
// List item — compact (Dashboard)
// ---------------------------------------------------------------------------

export interface TracePoint {
  turnIndex: number;
  cost: number;
  timestamp: string;
}

export interface SessionListItem {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  project: string;
  model: string;
  branch?: string;
  host?: string;
  durationMs: number;
  turnCount: number;
  costComputed: number;
  cacheSavingsComputed?: number;
  maxTurnCostComputed?: number;
  contextPctEstimated?: number;
  /** Reserved for #P4-12 — gate score (Report Card letter as fraction). */
  gateScore?: number;
  /** Reserved for #P4-12 — rolled-up session gate status (`pass`/`warn`/`fail`). */
  gateStatus?: string;
  /** Opt-in: cumulative priced turn values. Present only when include=trace. */
  trace?: TracePoint[];
}

// ---------------------------------------------------------------------------
// Page item — strict (Sessions page)
// ---------------------------------------------------------------------------

/**
 * The page-row / compare-row projection (ARCH `SessionPageItem`). Distinct
 * from `SessionListItem`: full `models[]` (not just the first), the
 * transcript-tier `entrypoint` / `version`, a `tier` flag set, derived
 * `hasDrilldown`, and a server-computed `totalTokens` sum across the four
 * stored token categories.
 *
 * Optional premium/gate/tag fields stay honest (no fabrication when no
 * upstream parser populates them yet) — the page renders them as locked
 * cells with the established "—" placeholder (ARCH A11).
 */
export interface SessionPageItem {
  sessionId: string;
  startedAt: string;
  lastAt: string;
  project: string;
  /** Full multi-model list, in encounter order (vs `SessionListItem.model` which collapses to first). */
  models: string[];
  branch?: string;
  /** Currently always "default" — the same synthetic value the metrics engine emits (#P4-15 will supply real labeled roots). */
  host: string;
  entrypoint: string;
  version: string;
  /** Session start→last activity, in milliseconds. */
  durationMs: number;
  turnCount: number;
  /** Sum of `inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens` for this session. */
  totalTokens: number;
  /** Cache hit rate as a fraction in [0,1] (matches `Session.cacheHitPct`). */
  cacheHitPct: number;
  /** Computed $ — always present (tier-dependent display, but never fabricated as 0). */
  costComputed: number;
  /** Observed $ from the cost sidecar (premium tier). */
  costObserved?: number;
  /** Premium tier — line-change counts. */
  linesAdded?: number;
  linesRemoved?: number;
  /** Estimated context percentage, transcript tier. */
  contextPctEstimated?: number;
  /** Reserved for #P4-13 — observed context percentage. Never inferred from the estimate. */
  contextPctObserved?: number;
  /** Reserved for #P4-12 — gate score and status. */
  gateScore?: number;
  gateStatus?: string;
  /** Reserved for #P4-15 — user-set tags. */
  tags?: string[];
  /** `turnCount > 0`. Computed from `Session.turnCount`. */
  hasDrilldown: boolean;
  /** Per-session TierFlags (mirrors the existing `Session.tier`). */
  tier: TierFlags;
}

/**
 * A small identity projection for the timeline/Gantt view (ARCH
 * `SessionTimelineItem`). Each row is a focusable bar, so it carries
 * sessionId, project, start/end, and computed cost — enough to render and
 * to drill into.
 */
export interface SessionTimelineItem {
  sessionId: string;
  project: string;
  startedAt: string;
  lastAt: string;
  costComputed: number;
}

/**
 * Bounded identity-bearing data for the table/Gantt toggle (ARCH A5/R11).
 * Total visual points are capped at 500 with deterministic outlier-
 * preserving sampling; population/eligibility/return/sampling metadata is
 * always returned so the UI can disclose when truncation occurred.
 */
export interface SessionTimelineSet {
  items: SessionTimelineItem[];
  matched: number;
  eligible: number;
  returned: number;
  /** `true` only when `returned < eligible`. */
  sampled: boolean;
  /** Sessions dropped from `eligible` because their start/end instants were unparseable. */
  excludedInvalidTime: number;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface SessionListMeta {
  matchedExtent: { from: string; to: string } | null;
  globalCapture: TierFlags;
  /**
   * Cost-capture setup guide readout (#P4-15). `capturingSessions` counts
   * sessions with `tier.hasCostSamples` true (the same signal
   * `globalCapture` ORs across the fleet); `lastCapturedAt` is the most
   * recent `lastAt` among them, or `null` when none are capturing yet.
   * Computed alongside the existing `globalCapture` pass — no extra route.
   */
  captureSummary: { capturingSessions: number; lastCapturedAt: string | null };
}

export interface SessionListResponse {
  items: SessionListItem[];
  total: number;
  meta: SessionListMeta;
}

export interface SessionPageMeta extends SessionListMeta {
  /** Exact matched population before any timeline eligibility / sampling. */
  matched: number;
}

/**
 * Page projection response (ARCH `SessionPageResponse`). `timeline` is
 * present only when `?include=timeline` was requested on the same query;
 * the existing `meta.matchedExtent` and `meta.globalCapture` carry through
 * so the page can render the same chrome and filter-bar affordances the
 * Dashboard already uses.
 */
export interface SessionPageResponse {
  items: SessionPageItem[];
  total: number;
  meta: SessionPageMeta;
  timeline?: SessionTimelineSet;
}
