import type { ScoreLetter } from "../../shared/gates-contract.js";
import type {
  BiggestLever,
  CacheCreationEntry,
  CacheScorecardCore,
  CacheScorecardCoreWithMeta,
  ScorecardBands,
  ScorecardFilters,
  ScorecardGradeState,
  ScorecardRange,
  ScorecardSessionMeta,
  ScorecardThresholds,
  WasteCostBasis,
  WasteEventKind,
  WasteEventView,
} from "../../shared/scorecard-contract.js";
import type { PricingTable } from "../metrics/measures.js";

/**
 * The pure serving-layer fleet projector (mirrors `store/fleet-baselines.ts`):
 * band calibration, letter mapping, dollar pricing, and range+filter
 * Biggest-Lever selection over cores the Store already cached. Never reads
 * the Store or the clock — the route injects cores, pricing, range, filters
 * (ARCH-124 Module Boundaries rule 2).
 */

const LETTER_ORDER: ScoreLetter[] = ["F", "D", "C", "B", "A"];

function bucketGrade(
  scorePercent: number,
  bands: { A: number; B: number; C: number; D: number },
): ScoreLetter {
  if (scorePercent >= bands.A) return "A";
  if (scorePercent >= bands.B) return "B";
  if (scorePercent >= bands.C) return "C";
  if (scorePercent >= bands.D) return "D";
  return "F";
}

/** Nearest-rank percentile (gates.md "Grade thresholds and calibration"): rank = ceil(p/100 * n). */
function nearestRankPercentile(sortedAscending: number[], percentile: number): number {
  const n = sortedAscending.length;
  if (n === 0) return 0;
  const rank = Math.ceil((percentile / 100) * n);
  const index = Math.min(Math.max(rank - 1, 0), n - 1);
  return sortedAscending[index] ?? 0;
}

/**
 * Fixed bands below `calibrationMinSessions`; nearest-rank p80/p60/p40/p20
 * bands once the fleet has enough gradeable sessions (A5). `gradeableScores`
 * are `hygieneScore` fractions (0-1) from cores at/above `floorCalls` with a
 * non-null score — the caller selects that population.
 */
export function resolveBands(
  gradeableScores: number[],
  thresholds: ScorecardThresholds,
): ScorecardBands {
  if (gradeableScores.length < thresholds.calibrationMinSessions) {
    return { A: thresholds.A, B: thresholds.B, C: thresholds.C, D: thresholds.D, source: "fixed" };
  }
  const sortedPercents = gradeableScores.map((score) => score * 100).sort((a, b) => a - b);
  return {
    A: nearestRankPercentile(sortedPercents, 80),
    B: nearestRankPercentile(sortedPercents, 60),
    C: nearestRankPercentile(sortedPercents, 40),
    D: nearestRankPercentile(sortedPercents, 20),
    source: "calibrated",
  };
}

/**
 * Discriminated grade state for one core. Calibrated bands may improve the
 * fixed-band letter by at most one grade and never lower it (A5) — capped
 * via `LETTER_ORDER` rank rather than trusting the calibrated bucket alone.
 */
export function applyGrade(
  core: CacheScorecardCore,
  bands: ScorecardBands,
  thresholds: ScorecardThresholds,
): ScorecardGradeState {
  if (core.mainThreadCalls === 0) return { state: "no-main-thread-calls" };
  if (core.mainThreadCalls < thresholds.floorCalls) {
    return {
      state: "too-short",
      mainThreadCalls: core.mainThreadCalls,
      floorCalls: thresholds.floorCalls,
    };
  }
  if (core.hygieneScore === null) return { state: "no-scoreable-creation" };

  const scorePercent = core.hygieneScore * 100;
  const fixedLetter = bucketGrade(scorePercent, thresholds);
  let grade = fixedLetter;
  if (bands.source === "calibrated") {
    const calibratedLetter = bucketGrade(scorePercent, bands);
    const fixedRank = LETTER_ORDER.indexOf(fixedLetter);
    const calibratedRank = LETTER_ORDER.indexOf(calibratedLetter);
    const cappedRank = Math.min(
      Math.max(calibratedRank, fixedRank),
      fixedRank + 1,
      LETTER_ORDER.length - 1,
    );
    grade = LETTER_ORDER[cappedRank] ?? fixedLetter;
  }

  return { state: "graded", grade, hygieneScore: core.hygieneScore, bands };
}

/** R6 deep-link target: a resolvable turn goes to Turn Inspector; a missing one degrades to the session's scorecard section. */
function buildDeepLink(sessionId: string, turnNumber: number | null): string {
  return turnNumber !== null
    ? `/session/${sessionId}/turn/${turnNumber}`
    : `/sessions/${sessionId}#cache-scorecard`;
}

/**
 * The single source of the R10 dollar formula (A7/A14): incremental loss
 * vs. a hit, `null` — never `$0` — when the model has no pricing rate. Cost
 * basis is always `"computed"`/`"unavailable"`, never a session's `"observed"`
 * basis. Exported so `routes/scorecard.ts` (T5) prices per-session events
 * through this one function instead of duplicating the formula.
 */
export function priceWasteEntry(
  entry: CacheCreationEntry & { kind: WasteEventKind },
  sessionId: string,
  pricing: PricingTable,
): WasteEventView {
  const rate = pricing[entry.model];
  const costEstimate = rate
    ? (entry.rewrittenTokens * Math.max(rate.cacheCreate - rate.cacheRead, 0)) / 1_000_000
    : null;
  const costBasis: WasteCostBasis = rate ? "computed" : "unavailable";
  return {
    eventId: entry.eventId,
    callId: entry.callId,
    promptId: entry.promptId,
    turnNumber: entry.turnNumber,
    timestamp: entry.timestamp,
    model: entry.model,
    project: entry.project,
    branch: entry.branch,
    kind: entry.kind,
    baseCause: entry.baseCause,
    attribution: entry.attribution,
    tokensRewritten: entry.rewrittenTokens,
    costEstimate,
    costBasis,
    deepLink: buildDeepLink(sessionId, entry.turnNumber),
  };
}

function matchesFilters(
  entry: CacheCreationEntry,
  meta: ScorecardSessionMeta,
  filters: ScorecardFilters,
): boolean {
  if (filters.project && filters.project.length > 0 && !filters.project.includes(entry.project)) {
    return false;
  }
  if (filters.model && filters.model.length > 0 && !filters.model.includes(entry.model)) {
    return false;
  }
  if (filters.branch && filters.branch.length > 0 && !filters.branch.includes(entry.branch)) {
    return false;
  }
  if (filters.host && filters.host.length > 0 && !filters.host.includes(meta.host)) {
    return false;
  }
  return true;
}

function inRange(timestamp: string, range: ScorecardRange): boolean {
  return timestamp >= range.from && timestamp <= range.to;
}

interface Candidate {
  entry: CacheCreationEntry & { kind: WasteEventKind };
  sessionId: string;
  sessionProject: string;
}

/** A9 tie-break: tokens desc, timestamp desc, then sessionId asc, then callId asc. */
function isBetterCandidate(candidate: Candidate, current: Candidate): boolean {
  if (candidate.entry.rewrittenTokens !== current.entry.rewrittenTokens) {
    return candidate.entry.rewrittenTokens > current.entry.rewrittenTokens;
  }
  if (candidate.entry.timestamp !== current.entry.timestamp) {
    return candidate.entry.timestamp > current.entry.timestamp;
  }
  if (candidate.sessionId !== current.sessionId) {
    return candidate.sessionId < current.sessionId;
  }
  return candidate.entry.callId < current.entry.callId;
}

/**
 * R7/R8 Biggest-Lever selection: the max in-range, filter-matching waste
 * event by `tokensRewritten`, priced; or a healthy first-write-share summary
 * when the period has creation but no waste; or a distinct no-cache-activity
 * state when the period has no creation at all (A12). Membership is decided
 * by each entry's own timestamp, not the session's (A9).
 */
export function selectBiggestLever(
  cores: CacheScorecardCoreWithMeta[],
  range: ScorecardRange,
  filters: ScorecardFilters,
  pricing: PricingTable,
): BiggestLever {
  let best: Candidate | undefined;
  let firstWriteTokens = 0;
  let totalCreationTokens = 0;

  for (const core of cores) {
    for (const entry of core.writes) {
      if (!inRange(entry.timestamp, range)) continue;
      if (!matchesFilters(entry, core.sessionMeta, filters)) continue;

      totalCreationTokens += entry.warmupTokens + entry.incrementalTokens + entry.rewrittenTokens;
      firstWriteTokens += entry.warmupTokens + entry.incrementalTokens;

      if (entry.kind === null) continue;
      const candidate: Candidate = {
        entry: entry as CacheCreationEntry & { kind: WasteEventKind },
        sessionId: core.sessionId,
        sessionProject: core.sessionMeta.project,
      };
      if (!best || isBetterCandidate(candidate, best)) best = candidate;
    }
  }

  if (best) {
    const view = priceWasteEntry(best.entry, best.sessionId, pricing);
    return {
      ...view,
      state: "event",
      sessionId: best.sessionId,
      sessionProject: best.sessionProject,
    };
  }

  if (totalCreationTokens === 0) {
    return {
      state: "no-cache-activity",
      firstWriteTokens: 0,
      totalCreationTokens: 0,
      firstWriteShare: null,
    };
  }

  return {
    state: "healthy",
    firstWriteTokens,
    totalCreationTokens,
    firstWriteShare: firstWriteTokens / totalCreationTokens,
  };
}
