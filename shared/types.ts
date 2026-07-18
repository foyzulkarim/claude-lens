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
