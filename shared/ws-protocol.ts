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

export type WsServerMessage = SessionUpdated | SessionAdded | ScanUpdated;
