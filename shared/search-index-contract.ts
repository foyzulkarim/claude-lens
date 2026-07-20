/**
 * Prompt-search wire contract (#P4-3, issue #35).
 *
 * `GET /api/search-index` ships every user prompt in the in-memory store
 * as a denormalized `PromptSearchDoc[]` so the client can build a
 * MiniSearch index lazily — keeping `minisearch` a client-only
 * dependency (CLAUDE.md §2 dep table) and matching architecture §11's
 * "search-as-you-type without server round-trips" contract.
 *
 * `turnNumber` is resolved server-side from the session's `Turn[]` so
 * the client never has to call back to render a result row's
 * `/sessions/:id?turn=N` deep-link. Empty corpus is a valid 200; the
 * client renders an empty-state, never a fake-loading shimmer.
 */

/**
 * One prompt as a MiniSearch-ready document. The `id` is
 * `"<sessionId>:<promptId>"` — globally unique by construction.
 * Only `text` is indexed for matching; the rest are present for the
 * result-row metadata line and the deep-link.
 */
export interface PromptSearchDoc {
  /** Globally unique doc id: `"<sessionId>:<promptId>"`. */
  id: string;
  /** Owning session — direct from `PromptTextRecord.sessionId`. */
  sessionId: string;
  /** Prompt id within the session — direct from `PromptTextRecord.promptId`. */
  promptId: string;
  /**
   * 1-based turn number within the session, resolved server-side from the
   * derived `Turn[]` index matching `promptId`. A prompt that doesn't
   * resolve to a turn (e.g. user line without a subsequent assistant call)
   * gets `state.turns.length + 1` — the next turn slot, so the deep-link
   * still lands on the right panel even at the trailing edge.
   */
  turnNumber: number;
  /** Full user-prompt text — the only indexed field for MiniSearch. */
  text: string;
  /** ISO timestamp of the user line, from `PromptTextRecord.timestamp`. */
  timestamp: string;
  /**
   * Working directory of the session at the time of the prompt, when
   * known. NOT indexed — present for the result-row context line.
   */
  cwd?: string;
  /**
   * Git branch of the session at the time of the prompt, when known.
   * NOT indexed — present for the result-row context line.
   */
  gitBranch?: string;
}

/**
 * Top-level response shape for `GET /api/search-index`. `version` is
 * monotonic per server process — lets the client detect stale indexes
 * if a future change introduces incremental updates over time. Today
 * it bumps on every snapshot rebuild; the client treats it as opaque.
 */
export interface SearchIndexResponse {
  /** Sorted by `(timestamp ASC, sessionId ASC, promptId ASC)` — deterministic. */
  prompts: PromptSearchDoc[];
  /** Monotonic snapshot version. Bumps every rebuild. */
  version: number;
}
