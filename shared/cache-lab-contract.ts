/**
 * Cache Lab wire contract — additive vocabulary for the dedicated Cache Lab
 * analysis endpoint (architecture §7; ARCH-cache-lab-page §API Contracts).
 * The page's "ordinary" token/hit-rate/distribution/trend data continues
 * through the generic `MetricsQuery`; this contract is solely for the
 * cache-specific classified events, economics, and bounded sections that
 * do not fit the measure × dimension × grain shape.
 *
 * Mirrors `metrics-contract.ts`'s exhaustiveArray<T> pattern so adding a
 * new cause/attribution/verdict literal without updating the matching
 * array fails at compile time (see cache-lab-contract.test.ts).
 */

import type { Dimension, Grain } from "./metrics-contract.js";

// Forces every literal of T into the returned array — the `[T] extends
// [U[number]] ? unknown : never` trick (wrapped in tuples to block union
// distribution) fails to compile if `array` omits a union member, so
// CACHE_WRITE_CAUSES / CACHE_MISS_ATTRIBUTIONS / MISS_ATTRIBUTION_VERDICTS
// below can't silently drift out of sync with their union types the way a
// hand-copied Set literal could.
function exhaustiveArray<T extends string>() {
  return <U extends readonly T[]>(array: U & ([T] extends [U[number]] ? unknown : never)): U =>
    array;
}

// ---------------------------------------------------------------------------
// K2 base cause vocabulary (gates.md K2 + ARCH §A2/A3)
// ---------------------------------------------------------------------------

/**
 * One of the four normative K2 outcomes — applied per logical stream in
 * classifier-precedence order (first-call → model-switch → compaction →
 * unexplained). Reused verbatim by gates-engine #P4-11, so this vocabulary
 * is part of the gates contract; do not add or rename values without a
 * spec change.
 */
export type CacheWriteCause = "first-call" | "model-switch" | "compaction" | "unexplained";

export const CACHE_WRITE_CAUSES = exhaustiveArray<CacheWriteCause>()([
  "first-call",
  "model-switch",
  "compaction",
  "unexplained",
]);

// ---------------------------------------------------------------------------
// TTL attribution overlay (independent of K2 base cause — ARCH §A4)
// ---------------------------------------------------------------------------

/**
 * Conservative interpretation of the current cache write's idle gap and
 * represented TTL buckets. Decoupled from `CacheWriteCause` so a later
 * change to K2 precedence cannot silently rewrite Cache Lab's TTL
 * semantics. `unknown` is the honest default for ambiguous evidence
 * (mixed buckets, missing timestamps, malformed input, etc.).
 */
export type CacheMissAttribution = "ttl-lapse" | "prefix-change" | "unknown";

export const CACHE_MISS_ATTRIBUTIONS = exhaustiveArray<CacheMissAttribution>()([
  "ttl-lapse",
  "prefix-change",
  "unknown",
]);

// ---------------------------------------------------------------------------
// Attribution roll-up verdict
// ---------------------------------------------------------------------------

/**
 * The single label the page surfaces in the Miss Attribution panel — the
 * roll-up of the three counts. `mixed` means both TTL-lapse and prefix-
 * change are non-zero; `insufficient-evidence` means all counts are zero
 * or only `unknown` is non-zero (the cache never invalidated for a
 * classified reason); `no-events` means there were no classified cache
 * writes at all in the filtered window.
 */
export type MissAttributionVerdict =
  | "ttl-lapse"
  | "prefix-change"
  | "mixed"
  | "insufficient-evidence"
  | "no-events";

export const MISS_ATTRIBUTION_VERDICTS = exhaustiveArray<MissAttributionVerdict>()([
  "ttl-lapse",
  "prefix-change",
  "mixed",
  "insufficient-evidence",
  "no-events",
]);

// ---------------------------------------------------------------------------
// Bounded response caps (ARCH §A8)
// ---------------------------------------------------------------------------

/**
 * Server-side response caps — the analyzer trims gallery/context sections
 * to these limits and surfaces `truncated: true` plus the unfiltered
 * `total` so the page can honestly say "showing N of M" instead of
 * implying completeness. The page's Cypress/spec assertions depend on
 * these values staying fixed unless both sides change in lockstep.
 */
export const CACHE_LAB_LIMITS = {
  GALLERY_MAX_ITEMS: 50,
  CONTEXT_MAX_CURVES: 24,
} as const;

// ---------------------------------------------------------------------------
// Classifier trace (ARCH §ClassifiedCacheWrite)
// ---------------------------------------------------------------------------

/**
 * Structured, prompt-free facts the classifier recorded about the
 * classification. Always present on every `ClassifiedCacheWrite` —
 * numeric/boolean values only, never prompt text or tool input bodies.
 * The current call's `model`, the previous call's `model` and
 * `cacheReadTokens`, and the call-before-previous's `cacheReadTokens`
 * are enough to reconstruct the K2 verdict in one glance.
 *
 * TTL overlay fields record the idle gap to the previous write in the
 * same stream and which TTL buckets the current write actually used
 * (`represented5m` / `represented1h`); a write that omitted the optional
 * `cache_creation.ephemeral_*_input_tokens` fields lands as both
 * `false`, which the attribution overlay conservatively maps to
 * `unknown` unless the idle gap is provably beyond every represented TTL.
 */
export interface ClassifierTrace {
  isFirstCall: boolean;
  previousModel: string | null;
  modelSwitched: boolean;
  previousCacheReadTokens: number | null;
  beforePreviousCacheReadTokens: number | null;
  // (before-prev - prev) / before-prev, in [0, 1]. Null when either
  // previous read is missing (insufficient compaction history).
  compactionRatio: number | null;
  compactionDetected: boolean;
  // Idle gap between the current write and the previous call in the
  // same stream, in milliseconds. Null when there is no previous call.
  ttlGapMs: number | null;
  represented5m: boolean;
  represented1h: boolean;
}

// ---------------------------------------------------------------------------
// Classified cache write event
// ---------------------------------------------------------------------------

/**
 * One cache-write event whose `cacheCreateTokens` exceeds the K2 spike
 * threshold of 10_000 (gates.md K2 default; strict `>` per ARCH §A3).
 * Includes the K2 base cause, the independent TTL attribution, the
 * classifier trace, and the per-event economic facts (all null when
 * pricing is incomplete — see analyzer nullability contract).
 *
 * `streamKey` is `"main"` for the session's main thread and `"agent-<id>"`
 * for sidechain sub-agent streams; the analyzer partitions calls by
 * (sessionId, streamKey) before classification so evidence never leaks
 * across streams (gates.md §Shared preprocessing also excludes
 * sidechain calls from K2; Cache Lab surfaces them for completeness but
 * the classifier still scopes per-stream).
 */
export interface ClassifiedCacheWrite {
  sessionId: string;
  callId: string;
  messageId: string;
  promptId?: string;
  turnIndex?: number;
  streamKey: string;
  timestamp: string;
  model: string;
  cacheCreateTokens: number;
  baseCause: CacheWriteCause;
  attribution: CacheMissAttribution;
  trace: ClassifierTrace;
  // Bust-loss dollar estimate for THIS specific event (cacheCreateTokens
  // × max(cacheCreateRate - cacheReadRate, 0) / 1_000_000). Null when
  // any scoped model needed for the bust's pricing is unpriced.
  bustLossComputed: number | null;
  // Session-level net cache benefit (cache savings - bust loss) at the
  // time of this event, scoped to the same range/filters as the request.
  // Null follows the same pricing rule as bustLossComputed.
  sessionNetComputed: number | null;
  // True iff sessionNetComputed < 0 — kept as a separate field so a
  // missing net value (pricing unpriced) is honest null rather than
  // collapsing to `false` and pretending everything is net-positive.
  sessionNetNegative: boolean | null;
}

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

/**
 * One Cache Lab analysis request. Mirrors the relevant subset of
 * `MetricsQuery` (range, filters, grain) so the global URL filter bar
 * can hand its state here unchanged. `spikeThreshold` is not accepted
 * over HTTP — Settings (#P4-15) owns the future persistence seam; the
 * route injects the current default (10_000) today.
 */
export interface CacheLabQuery {
  range: { from: string; to: string };
  filters?: Partial<Record<Dimension, (string | number)[]>>;
  grain: Grain;
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * Cache-economics roll-up for the filtered window. Every numeric value is
 * `number | null`; null means "couldn't compute" (typically because the
 * scoped call set contains an unpriced model), never 0. `pricingComplete`
 * is the single signal the UI uses to decide whether to render the
 * dollar-formatted panels or an explicit "unpriced" state — the page
 * shows `0`/`$0` only when there really were no token costs to sum.
 *
 * Bust-loss semantics: only first-call classifications are excluded from
 * `bustCount`/`bustLoss` (a session's first cache write cannot be a bust
 * — there was no prior cache to invalidate). `netBenefit` =
 * `cacheSavings - bustLoss`; `netNegativeSessionCount` is the count of
 * scoped sessions whose own net is < 0.
 */
export interface CacheEconomics {
  actualCost: number | null;
  cacheSavings: number | null;
  uncachedCost: number | null;
  bustLoss: number | null;
  netBenefit: number | null;
  bustCount: number;
  netNegativeSessionCount: number;
  pricingComplete: boolean;
}

/**
 * Three counts plus a single verdict chip. The verdict roll-up rule is
 * owned by the analyzer; consumers should display whatever verdict it
 * produces rather than recomputing locally.
 */
export interface MissAttributionSummary {
  ttlLapseCount: number;
  prefixChangeCount: number;
  unknownCount: number;
  verdict: MissAttributionVerdict;
}

/**
 * Cache creation tokens split into the 5m / 1h TTL buckets the Anthropic
 * API actually reports. `unknownTokens` reconciles
 * `5m + 1h + unknown == total` even when the upstream
 * `cache_creation.ephemeral_*_input_tokens` fields are absent on some
 * calls (ARCH §A5 / §TTL Reconciliation).
 */
export interface TtlMix {
  ephemeral5mTokens: number;
  ephemeral1hTokens: number;
  unknownTokens: number;
}

/**
 * One bucket of the baseline-weight trend. `medianTokens` is the median
 * of "first nonzero main-chain cache write per session" values within
 * the bucket; `sampleCount` is the number of sessions that contributed
 * (median over zero samples is meaningless, so a bucket with zero
 * samples surfaces `medianTokens: null` and `sampleCount: 0` honestly
 * rather than zero-filling a false claim).
 */
export interface BaselinePoint {
  t: string;
  medianTokens: number | null;
  sampleCount: number;
}

export interface BaselineTrend {
  grain: Grain;
  points: BaselinePoint[];
}

/**
 * Per-bucket invalidation cost split by K2 cause. Same nullability as
 * `bustLoss` — if a cause's only contributing calls are unpriced, its
 * per-bucket amount is null while the others stay numeric. First-call
 * spikes never contribute (a session's first cache write cannot be an
 * invalidation).
 */
export interface InvalidationCostPoint {
  t: string;
  modelSwitch: number | null;
  compaction: number | null;
  unexplained: number | null;
}

export interface InvalidationCostTrend {
  grain: Grain;
  points: InvalidationCostPoint[];
}

/**
 * One invalidation gallery row. Field set is the public-safe subset of
 * `ClassifiedCacheWrite` — deliberately excludes `promptText`, tool
 * input, tool-result bodies, and the classifier trace. `turnIndex` and
 * `promptId` enable a deep-link to Turn Inspector when the call is
 * attributable to a derived turn; either being absent renders a
 * non-link fallback rather than a fabricated URL.
 */
export interface GalleryItem {
  sessionId: string;
  callId: string;
  messageId: string;
  promptId?: string;
  turnIndex?: number;
  streamKey: string;
  timestamp: string;
  model: string;
  cacheCreateTokens: number;
  baseCause: CacheWriteCause;
  attribution: CacheMissAttribution;
  bustLossComputed: number | null;
}

/**
 * One session's input-context curve — one point per derived turn, main chain
 * only. `inputTokens` (the largest input seen in the turn) is the always-present
 * token-estimated proxy. `contextPct` is the observed context-window percentage
 * (0-100) reconciled from C cost samples (#P4-13); present only when the
 * session has premium capture. The section's `basis` reports which the panel is
 * showing.
 */
export interface ContextGrowthPoint {
  turnIndex: number;
  timestamp: string;
  inputTokens: number;
  /** Observed context-window percentage (0-100) from C cost samples (#P4-13). */
  contextPct?: number;
}

export interface ContextGrowthCurve {
  sessionId: string;
  points: ContextGrowthPoint[];
}

export interface ContextGrowthSection {
  curves: ContextGrowthCurve[];
  total: number;
  truncated: boolean;
  /**
   * `"observed"` (🟢) when every shown curve carries observed `contextPct`
   * (premium capture present for all of them), otherwise `"token-estimated"`
   * (🟡, the `inputTokens` proxy). Panel-level so the tier badge never
   * over-claims a mixed fleet. (#P4-13)
   */
  basis: "token-estimated" | "observed";
}

/**
 * Bounded Cache Lab response. Every section is always present (the page
 * never has to null-check a section it expects), but individual
 * numeric/optional fields inside each section may be null per their own
 * nullability rules. `gallery` and `contextGrowth` carry `total` +
 * `truncated` so the UI can honestly disclose what it is and isn't
 * showing.
 */
export interface CacheLabAnalysis {
  economics: CacheEconomics;
  attribution: MissAttributionSummary;
  ttlMix: TtlMix;
  baseline: BaselineTrend;
  invalidationCost: InvalidationCostTrend;
  gallery: {
    items: GalleryItem[];
    total: number;
    truncated: boolean;
  };
  contextGrowth: ContextGrowthSection;
}
