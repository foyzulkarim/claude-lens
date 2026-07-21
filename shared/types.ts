/**
 * Store vocabulary — ApiCall is the deduped assistant API-response atom;
 * Turn and Session are derived aggregates. See specs/architecture/ARCH-shared-contracts.md.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  cacheCreate5m?: number;
  cacheCreate1h?: number;
  webSearchRequests?: number;
  webFetchRequests?: number;
}

export interface ToolUseRef {
  name: string;
  inputBytes: number;
  /**
   * The `tool_use` block's own id (Anthropic API's `content[].id`), when
   * present. Lets warm-cache reconstruction rebuild the toolUseId → name
   * map (server/ingest/parse-transcript.ts's Bash exit-code attribution)
   * from a cached ApiCall's tools without re-parsing the raw transcript
   * line. Optional so pre-existing test fixtures and cache entries that
   * predate this field remain valid.
   */
  id?: string;
  /**
   * Normalized target path for path-bearing tools (Read, Edit, Write,
   * NotebookEdit). Omitted for all other tool names so wire payloads and
   * warm-cache entries for non-path tools stay compact. Powers the
   * Session Detail "tool mix by file type" panels without retaining
   * tool inputs in general. (#P4-5)
   */
  targetPath?: string;
  /**
   * Coarse classification of Bash tool invocations. Only set when
   * `name === "Bash"`. `"git-commit"` covers any command that begins with
   * `git commit` (case-insensitive, leading whitespace tolerated) — the
   * one workflow signal needed by the Session Detail workflow funnel and
   * the future #P4-11/#P4-12 gates. (#P4-5, A7)
   */
  bashKind?: "git-commit" | "other";
  /**
   * Full Bash command string, retained for the V2 failing-command-loop gate
   * (#P4-11) which needs to detect repeated failures of the *same
   * normalized command* (gates.md §V2). The parser writes this verbatim
   * from the tool_use `input.command` field — only set for `Bash` blocks.
   * Unlike `bashKind` (a one-token classification), this is the full
   * command body, so it's bounded only by what the upstream tool_use
   * carries. Stored on the wire so V2 doesn't need a separate input
   * pipeline; the existing `compact tool metadata` rationale still holds
   * for every non-Bash tool where this field stays undefined.
   */
  bashCommand?: string;
}

export interface ApiCall {
  uuid: string;
  sessionId: string;
  messageId: string;
  requestId?: string;
  promptId?: string;
  agentId?: string;
  timestamp: string;
  model: string;
  usage: TokenUsage;
  stopReason?: string;
  isSidechain: boolean;
  tools: ToolUseRef[];
  isApiError?: boolean;
  apiErrorStatus?: number;
  cwd: string;
  gitBranch: string;
  version: string;
  entrypoint: string;
  /**
   * Observed premium fields (#P4-13) — populated only by
   * `server/store/reconcile-premium.ts` when a `<uuid>.cost.jsonl` (C) sidecar
   * exists for the session, absent on transcript-only calls. Each carries the
   * aggregate of the C samples attributed to this call (attribution =
   * "last call at-or-before the sample timestamp"): `costObserved` and
   * `linesAdded`/`linesRemoved` are summed, `apiMs` is the max observed API
   * duration, `contextPct` is the most recent (last) sample's context window
   * percentage (0-100, never summed). The transcript-only tier leaves all five
   * undefined so `undefined` cleanly reads as "unavailable", never "measured 0".
   */
  costObserved?: number;
  apiMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  contextPct?: number;
}

export interface Turn {
  promptId: string;
  sessionId: string;
  isSidechain: boolean;
  promptText?: string;
  promptSource?: string;
  startedAt: string;
  endedAt: string;
  calls: ApiCall[];
  usage: TokenUsage;
  toolResultBytes: number;
  wallMs?: number;
  gateStatus?: string;
  errorToolResults?: number;
  /**
   * Observed premium fields (#P4-13), aggregated from the C samples attributed
   * to this turn's calls (`apiMs` summed across the turn's calls,
   * `linesAdded`/`linesRemoved` summed). `wallMs` above upgrades to the
   * observed turn-boundary span (`turn_end` − `startedAt`) when a
   * `<uuid>.turn-boundaries.jsonl` (B) sidecar covers the turn. Undefined on
   * transcript-only turns.
   */
  apiMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface TierFlags {
  hasCostSamples: boolean;
  hasTurnBoundaries: boolean;
  hasCostLog: boolean;
  costBasis: "computed" | "observed";
}

export interface Session {
  sessionId: string;
  lineageId: string;
  slug?: string;
  project: string;
  entrypoint: string;
  models: string[];
  gitBranch: string;
  version: string;
  tier: TierFlags;
  firstAt: string;
  lastAt: string;
  /**
   * The label of the scan root this session's transcript was discovered
   * under (ARCH-settings-local-store.md), or `"unlabeled"` if the root has
   * no configured label. Resolved live from `Store.hostLabels`, so a
   * relabel via `PUT /api/config` takes effect without a restart.
   */
  host: string;
  usage: TokenUsage;
  turnCount: number;
  callCount: number;
  costComputed: number;
  costObserved?: number;
  durationMs?: number;
  cacheHitPct: number;
  linesAdded?: number;
  linesRemoved?: number;
  gateScore?: number;
  cacheSavingsComputed?: number;
  maxTurnCostComputed?: number;
  contextPctEstimated?: number;
  /**
   * Observed context-window percentage (#P4-13) — the most recent (last) C
   * sample's `context_pct` for this session, on a 0-1 scale to match
   * `contextPctEstimated`. Kept as a distinct field rather than overwriting the
   * estimated one so the two never masquerade for each other (the repo's
   * "estimated ≠ observed" honesty convention). Undefined unless a
   * `<uuid>.cost.jsonl` (C) sidecar exists for the session.
   */
  contextPctObserved?: number;
}
/**
 * A pre-priced turn sample used by the anomaly detector.
 * costComputed is expected to be a finite, non-negative number.
 */
export interface TurnCostSample {
  sessionId: string;
  turnId: string;
  costComputed: number;
}

/**
 * Marker for an explicit transcript compaction event, sourced from the
 * `system/compact_boundary` line type. Used by Session Detail to draw
 * compaction flags on the cost timeline; never used for cost or count
 * aggregation. (#P4-5)
 */
export interface CompactionRecord {
  /** Store partition key; matches the call's `sessionId`. */
  sessionId: string;
  /**
   * Timestamp from the source line when present and parseable. The
   * projector places the flag against the next logical turn/call by
   * ordering, so this is advisory rather than required.
   */
  timestamp?: string;
  /**
   * Direct prompt attribution when the source line supplies one. Optional
   * because not every compaction marker carries a prompt identity.
   */
  promptId?: string;
}
