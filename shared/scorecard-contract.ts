import type { CacheMissAttribution, CacheWriteCause } from "./cache-lab-contract.js";
import type { ScoreLetter } from "./gates-contract.js";

function exhaustiveArray<T extends string>() {
  return <U extends readonly T[]>(array: U & ([T] extends [U[number]] ? unknown : never)): U =>
    array;
}

export type WasteEventKind = "prefix-bust" | "duplicated-warmup" | "idle-expiry" | "unattributed";

export const WASTE_EVENT_KINDS = exhaustiveArray<WasteEventKind>()([
  "prefix-bust",
  "duplicated-warmup",
  "idle-expiry",
  "unattributed",
]);

/** Thresholds that control scorecard gradeability and letter mapping. */
export interface ScorecardThresholds {
  floorCalls: number;
  calibrationMinSessions: number;
  A: number;
  B: number;
  C: number;
  D: number;
}

export interface CacheCreationEntry {
  eventId: string;
  callId: string;
  promptId: string | null;
  turnNumber: number | null;
  timestamp: string;
  model: string;
  project: string;
  branch: string;
  warmupTokens: number;
  incrementalTokens: number;
  rewrittenTokens: number;
  baseCause: CacheWriteCause;
  attribution: CacheMissAttribution;
  kind: WasteEventKind | null;
}

export interface CacheScorecardCore {
  sessionId: string;
  mainThreadCalls: number;
  cacheReadTokens: number;
  writes: CacheCreationEntry[];
  decomposition: {
    warmup: number;
    incremental: number;
    rewritten: number;
  };
  wasteRatio: number | null;
  hitRatio: number;
  scoreInputs: {
    confirmedFixableWaste: number;
    scoreableCreation: number;
  };
  hygieneScore: number | null;
}

export interface WasteEvent {
  eventId: string;
  callId: string;
  promptId: string | null;
  turnNumber: number | null;
  timestamp: string;
  model: string;
  project: string;
  branch: string;
  kind: WasteEventKind;
  baseCause: CacheWriteCause;
  attribution: CacheMissAttribution;
  tokensRewritten: number;
}

export type WasteCostBasis = "computed" | "estimated" | "unavailable";

export interface WasteEventView extends WasteEvent {
  costEstimate: number | null;
  costBasis: WasteCostBasis;
  deepLink: string;
}

export interface ScorecardSessionMeta {
  sessionId: string;
  project: string;
  models: string[];
  branch: string;
  host: string;
}

export type CacheScorecardCoreWithMeta = CacheScorecardCore & {
  sessionMeta: ScorecardSessionMeta;
};

export interface ScorecardBands {
  A: number;
  B: number;
  C: number;
  D: number;
  source: "fixed" | "calibrated";
}

export type ScorecardGradeState =
  | {
      state: "graded";
      grade: ScoreLetter;
      hygieneScore: number;
      bands: ScorecardBands;
    }
  | {
      state: "too-short";
      mainThreadCalls: number;
      floorCalls: number;
    }
  | {
      state: "no-main-thread-calls";
    }
  | {
      state: "no-scoreable-creation";
    };

interface SessionScorecardViewBase {
  core: CacheScorecardCore;
  events: WasteEventView[];
  thresholdsUsed: ScorecardThresholds;
  evaluatedAt: string;
}

export type SessionScorecardView = SessionScorecardViewBase & ScorecardGradeState;

export interface ScorecardRange {
  from: string;
  to: string;
}

export interface ScorecardFilters {
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
}

export interface BiggestLeverEvent extends WasteEventView {
  state: "event";
  sessionId: string;
  sessionProject: string;
}

export interface BiggestLeverHealthy {
  state: "healthy";
  firstWriteTokens: number;
  totalCreationTokens: number;
  firstWriteShare: number;
}

export interface BiggestLeverNoCacheActivity {
  state: "no-cache-activity";
  firstWriteTokens: 0;
  totalCreationTokens: 0;
  firstWriteShare: null;
}

export type BiggestLever = BiggestLeverEvent | BiggestLeverHealthy | BiggestLeverNoCacheActivity;

export type BiggestLeverView = BiggestLever & { evaluatedAt: string };
