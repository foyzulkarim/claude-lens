/**
 * Invalidation bus only — never carries data. See architecture.md §7 and
 * specs/architecture/ARCH-shared-contracts.md.
 */

export interface SessionUpdated {
  type: "session-updated";
  sessionId: string;
}

export interface SessionAdded {
  type: "session-added";
  sessionId: string;
}

export interface ScanUpdated {
  type: "scan-updated";
}

/**
 * Emitted by the ingest pipeline after `applyRecords` resolves with a
 * non-empty `prompts` delta, in addition to the regular `session-updated`
 * for that same session (#P4-3, ARCH A2). Lets the client invalidate only
 * the search-index query key on a prompt-only mutation, instead of the
 * coarse `session-updated` which would also refetch metrics/sessions/detail.
 *
 * Wire consumers that don't yet know this type ignore it (the existing
 * `ws.ts` default-case path); old clients stay forward-compatible.
 */
export interface SessionPromptsChanged {
  type: "session-prompts-changed";
  sessionId: string;
}

export type WsServerMessage = SessionUpdated | SessionAdded | ScanUpdated | SessionPromptsChanged;
