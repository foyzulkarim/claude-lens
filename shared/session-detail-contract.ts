/**
 * Session Detail wire contract (#P4-5). Defines the complete read-only
 * resource returned by `GET /api/sessions/:id`. Every section the binding
 * pages spec calls out (header, cumulative timeline, per-turn bars, turn
 * table, turn-vs-history distribution, cache strip, tool mix/timeline,
 * prompt list, workflow funnel, token funnel, context composition) is
 * materialised server-side here; the client renders the response without
 * re-aggregating raw calls.
 *
 * Tier truthfulness: optional fields are reserved for #P4-13 premium data
 * and remain absent (undefined in the runtime guard) when unavailable —
 * never silently fabricated as 0. The `meta.availability` map names exactly
 * which optional slots a given response carried, so the page can render
 * honest "unavailable" states without re-deriving the rule.
 */

import type { TierFlags } from "./types.js";

// ---------------------------------------------------------------------------
// Availability vocabulary
// ---------------------------------------------------------------------------

/**
 * Names every optional field that the Session Detail response may or may not
 * carry. The page reads these to decide between a real value and an
 * unavailable state. Adding a new optional slot requires extending this
 * union so the runtime guard stays exhaustive. (#P4-5, A10)
 */
export type SessionDetailField =
  | "header.drift" // computed vs observed cost divergence — needs #P4-13
  | "header.contextPct" // premium-only; transcript-only sessions use derived estimate
  | "turn.apiMs" // API-vs-wall timing — needs #P4-13
  | "turn.linesAdded"
  | "turn.linesRemoved"
  | "turn.cacheSavings"
  | "turn.gateStatus" // gates ship in #P4-11
  | "toolMix.targetPaths" // never crosses the wire — only counts/bytes
  | "toolMix.shellCommands" // never crosses the wire — only kind counts
  | "cache.cause.freshSession" // needs first-call detection
  | "cache.cause.modelSwitch"
  | "cache.cause.compaction";

export interface SessionDetailMeta {
  /** "computed" today; "observed" once #P4-13 wires premium file parsing. */
  costBasis: "computed" | "observed";
  /** True iff the session has at least one parsed call. Empty sessions
   * return 200 with empty sections and this flag set to false. */
  isEmpty: boolean;
  /** True iff at least one call has arrived since the projector last ran —
   * informs the page's "live" indicator. */
  isLive: boolean;
  /** Optional fields the response actually carried. Absent from this set
   * means the page must render the unavailable state. */
  availability: SessionDetailField[];
  /** Size of the fleet baseline used for rank/percentile (logical prompt
   * turns across every session). Used by the page to label "your median"
   * comparisons honestly when the fleet is still warming up. */
  fleetBaselineSize: number;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface SessionDetailHeader {
  sessionId: string;
  project: string;
  branch: string;
  version: string;
  models: string[];
  firstAt: string;
  lastAt: string;
  logicalTurnCount: number;
  callCount: number;
  costComputed: number;
  costObserved?: number;
  /** Median session cost across the fleet (computed-only), for the
   * "vs your median" badge. Null when the fleet baseline has < 2 sessions. */
  fleetCostMedian: number | null;
  /** Percentile rank of this session's computed cost within the fleet.
   * Null when the fleet baseline has < 2 sessions. */
  fleetCostRankPct: number | null;
  contextPctEstimated?: number;
  tier: TierFlags;
  /** Computed-vs-observed divergence (premium only). Absent when #P4-13
   * hasn't supplied observed costs. */
  drift?: { delta: number; pct: number };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface SessionDetailTimelinePoint {
  /** Call index within the session, chronological. */
  callIndex: number;
  timestamp: string;
  /** Cumulative computed cost up to and including this call. */
  cumulativeCost: number;
  /** Cumulative token usage up to and including this call. */
  cumulativeTokens: number;
  /** Per-call computed cost. */
  cost: number;
  /** Per-call total tokens (input + output + cache read + cache create). */
  tokens: number;
  /** Estimated context usage at this call (inputTokens vs model window).
   * Computed from transcript data only; premium sample is future. */
  contextPct: number | null;
  /** Logical turn number this call belongs to. */
  turnNumber: number;
  /** True iff this point coincides with a logical turn boundary (first
   * call of its prompt). Used by the timeline to draw turn rules. */
  isTurnBoundary: boolean;
  /** True iff a `system/compact_boundary` marker was recorded at or
   * immediately before this call. */
  isCompaction: boolean;
}

// ---------------------------------------------------------------------------
// Turn detail
// ---------------------------------------------------------------------------

export interface SessionDetailTurn {
  turnNumber: number;
  promptId: string;
  promptText?: string;
  startedAt: string;
  endedAt: string;
  cost: number;
  /** Cost of the main-thread segment only; sidechain cost is the
   * remainder of `cost`. */
  mainCost: number;
  sidechainCost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  callCount: number;
  cacheHitPct: number;
  /** Tool breakdown: ordered tool name → (count, inputBytes). Sorted by
   * count descending so the page can render top tools without re-sorting. */
  tools: { name: string; count: number; inputBytes: number }[];
  /** Per-turn percentile rank within the fleet's logical-turn cost
   * distribution. Null when the fleet baseline has < 2 entries. */
  fleetPercentile: number | null;
  /** True iff this turn's cost exceeds the anomaly baseline × factor. */
  isAnomaly: boolean;
  /** Optional premium fields, only present when populated. */
  apiMs?: number;
  wallMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  cacheSavings?: number;
  gateStatus?: string;
  /** Sidechain attribution markers — true iff any sidechain segment
   * contributed to this turn's aggregates. */
  hasSidechain: boolean;
  /** First call model (multi-model turns are flagged here so the page can
   * surface a "model switch" indicator rather than naming all). */
  primaryModel: string;
  models: string[];
}

// ---------------------------------------------------------------------------
// Fleet distribution
// ---------------------------------------------------------------------------

export interface SessionDetailDistribution {
  populationSize: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  histogram: { rangeStart: number; rangeEnd: number; count: number }[];
  /** Basis: how the baseline population was sampled. "all-history" today;
   * Phase 5 may swap to a sampled/paginated variant. */
  basis: "all-history";
}

// ---------------------------------------------------------------------------
// Cache strip
// ---------------------------------------------------------------------------

export type SessionDetailCacheCause =
  | "first-call"
  | "model-switch"
  | "compaction"
  | "unexplained";

export interface SessionDetailCachePoint {
  callIndex: number;
  timestamp: string;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  hitRate: number;
  /** Determined by walking the call order against the same K2-compatible
   * rules. Always one of the four causes — "unexplained" is the honest
   * fallback when the prior call had a different model and there's no
   * compaction marker. */
  cause: SessionDetailCacheCause;
  /** True iff this point's `cacheCreateTokens` is high enough to be a
   * "write spike" worth labeling. */
  isWriteSpike: boolean;
}

// ---------------------------------------------------------------------------
// Tool mix
// ---------------------------------------------------------------------------

export interface SessionDetailToolMixItem {
  name: string;
  callCount: number;
  inputBytes: number;
  /** Originating-tool result bytes accumulated from compact tool-result
   * records, used by the Context Composition panel. */
  resultBytes: number;
  share: number;
}

export interface SessionDetailToolTimelineEvent {
  callIndex: number;
  timestamp: string;
  toolName: string;
  turnNumber: number;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface SessionDetailPrompt {
  turnNumber: number;
  promptId: string;
  timestamp: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Workflow funnel
// ---------------------------------------------------------------------------

export interface SessionDetailWorkflow {
  /** Edit cohort = turns with at least one Edit/Write/MultiEdit call. The
   * base denominator for every later stage. */
  baseEditCount: number;
  readFirstCount: number;
  plannedCount: number;
  verifiedCount: number;
  committedCount: number;
  /** Stage coverage labels in canonical funnel order. Each label is the
   * human-readable string for the corresponding count above. */
  stages: { id: "edit" | "read" | "plan" | "verify" | "commit"; label: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Token funnel
// ---------------------------------------------------------------------------

export interface SessionDetailTokenFunnel {
  /** Context offered = sum(input + cacheRead + cacheCreate) across calls. */
  contextOffered: number;
  /** Cache served = sum(cacheRead) across calls. */
  cacheServed: number;
  /** Fresh billed = sum(input + cacheCreate) across calls. */
  freshBilled: number;
  /** Output = sum(output) across calls. */
  output: number;
}

// ---------------------------------------------------------------------------
// Context composition
// ---------------------------------------------------------------------------

export interface SessionDetailContextItem {
  /** Originating tool name, or "Unknown" when the lookup failed. */
  toolName: string;
  bytes: number;
  share: number;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface SessionDetailResponse {
  header: SessionDetailHeader;
  timeline: SessionDetailTimelinePoint[];
  turns: SessionDetailTurn[];
  turnDistribution: SessionDetailDistribution;
  cache: SessionDetailCachePoint[];
  toolMix: SessionDetailToolMixItem[];
  toolTimeline: SessionDetailToolTimelineEvent[];
  prompts: SessionDetailPrompt[];
  workflow: SessionDetailWorkflow;
  tokenFunnel: SessionDetailTokenFunnel;
  contextComposition: SessionDetailContextItem[];
  meta: SessionDetailMeta;
}

/**
 * The error body returned by `/api/sessions/:id` when the session is
 * unknown. The route always emits `404` with this exact shape; callers
 * can switch on `error` rather than parsing the message.
 */
export interface SessionDetailError {
  error: "session not found";
  sessionId: string;
}