/**
 * Turn Inspector wire contract (#P4-6). Defines the two read-only resources
 * behind `GET /api/sessions/:id/turns/:n` and
 * `GET /api/sessions/:id/transcript?turn=n` (ARCH-turn-inspector-page.md).
 *
 * Tier truthfulness mirrors `session-detail-contract.ts`: optional fields
 * are reserved for #P4-13 premium data and stay absent (never fabricated)
 * when unavailable. `meta.availability` names exactly which optional slots
 * a given response carried.
 */

// ---------------------------------------------------------------------------
// Turn summary
// ---------------------------------------------------------------------------

export interface TurnInspectorSummary {
  sessionId: string;
  turnNumber: number;
  totalTurns: number;
  promptId: string;
  promptText?: string;
  startedAt: string;
  endedAt: string;
  cost: number;
  tokens: number;
  callCount: number;
  models: string[];
  primaryModel: string;
  /** Percentile rank of this turn's cost within the fleet's logical-turn
   * cost distribution. Null when the fleet baseline has < 2 entries. */
  fleetPercentile: number | null;
  isAnomaly: boolean;
  /** API-vs-wall timing split — needs #P4-13. Absent (never fabricated)
   * until premium cost-sample capture is wired. */
  apiMs?: number;
  wallMs?: number;
}

// ---------------------------------------------------------------------------
// API-call waterfall
// ---------------------------------------------------------------------------

export interface TurnInspectorWaterfallTool {
  name: string;
  inputBytes: number;
}

export interface TurnInspectorWaterfallCall {
  callIndex: number;
  messageId: string;
  timestamp: string;
  /** Milliseconds since the turn's first call — the timestamp-delta
   * fallback the pages spec calls for (🟡). Widths in the waterfall chart
   * fall back to this when observed `apiMs` is absent. */
  offsetMs: number;
  /** Observed per-call API duration in ms (#P4-13), reconciled from C cost
   * samples. When present, the waterfall sizes this call's bar by it (the
   * 🟢 upgrade); absent for transcript-only calls. */
  apiMs?: number;
  tokens: number;
  cost: number;
  tools: TurnInspectorWaterfallTool[];
  isSidechain: boolean;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

// ---------------------------------------------------------------------------
// Cache narrative
// ---------------------------------------------------------------------------

export type TurnInspectorCacheCause = "first-call" | "model-switch" | "compaction" | "unexplained";

export interface TurnInspectorCachePoint {
  callIndex: number;
  cause: TurnInspectorCacheCause;
  isWriteSpike: boolean;
  hitRate: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  /** Short generated prose, present only on notable points (write spikes /
   * unexplained causes) — mirrors the mockup's "28.6k tokens re-written…
   * unexplained (K2)" narrative line. */
  narrative?: string;
}

// ---------------------------------------------------------------------------
// Sidechain breakdown
// ---------------------------------------------------------------------------

export interface TurnInspectorSidechain {
  agentId?: string;
  cost: number;
  tokens: number;
  callCount: number;
  primaryModel: string;
}

export interface TurnInspectorSidechainBreakdown {
  mainCost: number;
  mainTokens: number;
  mainCallCount: number;
  sidechains: TurnInspectorSidechain[];
}

// ---------------------------------------------------------------------------
// Nav + meta
// ---------------------------------------------------------------------------

export interface TurnInspectorNav {
  prevTurnNumber: number | null;
  nextTurnNumber: number | null;
  totalTurns: number;
}

export type TurnInspectorField = "summary.apiMs" | "summary.wallMs";

export interface TurnInspectorMeta {
  costBasis: "computed" | "observed";
  availability: TurnInspectorField[];
  /** Size of the fleet baseline used for the percentile — mirrors
   * `SessionDetailMeta.fleetBaselineSize`. */
  fleetBaselineSize: number;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface TurnInspectorResponse {
  summary: TurnInspectorSummary;
  waterfall: { calls: TurnInspectorWaterfallCall[] };
  cacheNarrative: TurnInspectorCachePoint[];
  sidechainBreakdown: TurnInspectorSidechainBreakdown;
  nav: TurnInspectorNav;
  meta: TurnInspectorMeta;
}

/**
 * The error body returned by `/api/sessions/:id/turns/:n` when the session
 * or the turn number is unknown. `turnNumber` is only set for the
 * "turn not found" case.
 */
export interface TurnInspectorError {
  error: "session not found" | "turn not found";
  sessionId: string;
  turnNumber?: number;
}

// ---------------------------------------------------------------------------
// Transcript peek
// ---------------------------------------------------------------------------

export type TurnTranscriptPeekRole = "assistant-text" | "tool-use" | "tool-result";

export interface TurnTranscriptPeekLine {
  role: TurnTranscriptPeekRole;
  /** Set only for "tool-use"/"tool-result" roles. */
  toolName?: string;
  /** Truncated preview text — never the full raw content. */
  preview: string;
  /** Raw byte length of the source line's content, when known. */
  bytes?: number;
}

export interface TurnTranscriptPeekResponse {
  lines: TurnTranscriptPeekLine[];
  /** True when at least one line's raw content exceeded the preview cap. */
  truncated: boolean;
}

/**
 * The error body for `/api/sessions/:id/transcript?turn=n`. Distinct from
 * `TurnInspectorError` by the extra "transcript unavailable" cause — the
 * raw file couldn't be resolved or read even though the session/turn exist.
 */
export interface TurnTranscriptPeekError {
  error: "session not found" | "turn not found" | "transcript unavailable";
  sessionId: string;
  turnNumber?: number;
}
