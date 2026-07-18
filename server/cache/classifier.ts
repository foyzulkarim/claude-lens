import type { ApiCall } from "../../shared/types.js";
import type {
  CacheMissAttribution,
  CacheWriteCause,
  ClassifierTrace,
} from "../../shared/cache-lab-contract.js";

/**
 * Pure stream-partitioning primitive shared by the analyzer (T2) and the
 * fixture regression guard. Groups `ApiCall[]` by (sessionId, streamKey)
 * where `streamKey` is `"main"` for the session's main thread and the
 * literal `<agentId>` (e.g. `"agent-5555a"`) for sidechain sub-agent
 * streams. Every resulting stream is sorted by `timestamp` ascending so
 * `classifyCacheWrite(stream, i)` walks calls in chronological order.
 *
 * Sidechains share the parent's `promptId` (per `derive-turns`'s
 * convention) but get their own ordered stream here — that's exactly
 * what gates.md §Shared preprocessing needs ("exclude `isSidechain: true`
 * calls from all gates") to keep sub-agent prefix churn out of the
 * main-chain classification. Returning a Map (rather than nested
 * arrays) keeps callers from accidentally sharing references between
 * sessions.
 */
export function partitionCacheStreams(calls: ApiCall[]): Map<string, ApiCall[]> {
  const buckets = new Map<string, ApiCall[]>();
  // Calls inside one (sessionId, streamKey) are appended in their input
  // order; we sort once at the end so the cost is one sort per stream,
  // not a per-call insertion sort.
  const keyOf = (call: ApiCall): string => {
    const sessionPart = call.sessionId;
    if (call.isSidechain && typeof call.agentId === "string" && call.agentId.length > 0) {
      return `${sessionPart}::${call.agentId}`;
    }
    return `${sessionPart}::main`;
  };
  for (const call of calls) {
    const key = keyOf(call);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(call);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return buckets;
}

/**
 * Convenience: enumerate a session's main-chain stream key. Exported so
 * the analyzer (T2) can address the main stream by name without
 * recomputing the bucket string.
 */
export const MAIN_STREAM_KEY = "main";

/**
 * The K2 spike threshold — gates.md's default. A cache write with
 * `cacheCreateTokens` strictly greater than this value is a "cache
 * invalidation" by the gate's own definition. Strict `>` is normative
 * (ARCH §A3): writes at or below the threshold are not classified, so a
 * future 10_001-vs-10_000 boundary change here would alter which events
 * the gates engine sees. The single exported constant lets Settings
 * (#P4-15) override without a code edit.
 */
export const K2_SPIKE_THRESHOLD = 10_000;

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * The K2 base-cause classification for one cache write above the spike
 * threshold. The trace is the gate's evidence record — every check the
 * classifier ran and the value it observed, regardless of which rule
 * matched. Reused verbatim by the gates engine (#P4-11) and the Cache
 * Lab analyzer (T2); renaming or reshaping fields is a contract change.
 */
export interface ClassifiedBaseCause {
  baseCause: CacheWriteCause;
  trace: ClassifierTrace;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses an ISO-8601 timestamp into epoch milliseconds. Returns null for
 * any unparseable value (including empty strings) so the caller can map
 * "no timestamp" to "no TTL evidence" instead of poisoning the trace
 * with NaN.
 */
function parseTimestampMs(value: string): number | null {
  if (value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One parsed row consumed by the classifier — a current call plus
 * its previous two neighbors from the same ordered (sessionId,
 * streamKey) stream. Built once per classified call by `buildClassifierRow`
 * so the K2 checks stay readable.
 */
interface ClassifierRow {
  current: ApiCall;
  previous: ApiCall | undefined;
  beforePrevious: ApiCall | undefined;
}

/**
 * Materializes a 3-wide row at `callIndex` (the current call plus the
 * two preceding calls in the stream). Out-of-range indices return null —
 * the classifier never throws on index arithmetic, mirroring the
 * "insufficient compaction history" no-throw contract.
 */
function buildClassifierRow(stream: ApiCall[], callIndex: number): ClassifierRow | null {
  if (callIndex < 0 || callIndex >= stream.length) return null;
  const current = stream[callIndex];
  if (!current) return null;
  return {
    current,
    previous: stream[callIndex - 1],
    beforePrevious: stream[callIndex - 2],
  };
}

/**
 * The base-cause classifier — gates.md K2, applied per logical stream.
 * Mirrors the normative precedence: first-call → model-switch →
 * compaction → unexplained. First match wins. Returns null when the
 * current call's `cacheCreateTokens` is at or below the spike threshold
 * (strict `>`, ARCH §A3); the analyzer skips those calls entirely.
 *
 * The function never throws on insufficient history (e.g. a second call
 * with no before-previous); compaction checks that lack the prior two
 * reads short-circuit to "no compaction evidence" rather than producing
 * NaN ratios. The trace records which checks ran and the value each
 * one observed, so the gates engine can audit the result without
 * re-classifying.
 */
export function classifyCacheWrite(
  stream: ApiCall[],
  callIndex: number,
  options: { threshold?: number } = {},
): ClassifiedBaseCause | null {
  const threshold = options.threshold ?? K2_SPIKE_THRESHOLD;
  const row = buildClassifierRow(stream, callIndex);
  if (!row) return null;

  const { current, previous, beforePrevious } = row;
  const cacheCreateTokens = current.usage.cacheCreateTokens;

  // Strict `>` — writes at or below the threshold are not cache
  // invalidations by the gate's own definition.
  if (!(cacheCreateTokens > threshold)) return null;

  // Trace facts: populated up front so every branch can read them
  // without re-deriving them. These are observations, not verdicts —
  // the verdict (baseCause) is assigned by the rule chain below.
  const isFirstCall = previous === undefined;
  const previousModel = previous?.model ?? null;
  const modelSwitched = previous !== undefined && current.model !== previous.model;

  const previousCacheReadTokens = previous?.usage.cacheReadTokens ?? null;
  const beforePreviousCacheReadTokens = beforePrevious?.usage.cacheReadTokens ?? null;
  // Compaction ratio = (before-prev - prev) / before-prev, in [0, 1]
  // (clamped at 0 — negative ratios mean the cache actually grew, which
  // is not a compaction signal).
  let compactionRatio: number | null = null;
  let compactionDetected = false;
  if (previousCacheReadTokens !== null && beforePreviousCacheReadTokens !== null) {
    if (beforePreviousCacheReadTokens > 0) {
      const raw =
        (beforePreviousCacheReadTokens - previousCacheReadTokens) / beforePreviousCacheReadTokens;
      compactionRatio = Math.max(0, raw);
      compactionDetected = raw > 0.5; // strict `> 50%` per K2
    }
  }

  // TTL-overlay facts: written even though the base-cause verdict
  // doesn't read them, so the downstream `attributeCacheMiss` and the
  // gates engine's trace don't have to re-derive the gap.
  const currentMs = parseTimestampMs(current.timestamp);
  const previousMs = previous ? parseTimestampMs(previous.timestamp) : null;
  const ttlGapMs =
    currentMs !== null && previousMs !== null ? Math.max(0, currentMs - previousMs) : null;

  // A represented bucket is one the current write actually used.
  // Missing optional fields map to false (honest "we don't know").
  const represented5m =
    typeof current.usage.cacheCreate5m === "number" && current.usage.cacheCreate5m > 0;
  const represented1h =
    typeof current.usage.cacheCreate1h === "number" && current.usage.cacheCreate1h > 0;

  const trace: ClassifierTrace = {
    isFirstCall,
    previousModel,
    modelSwitched,
    previousCacheReadTokens,
    beforePreviousCacheReadTokens,
    compactionRatio,
    compactionDetected,
    ttlGapMs,
    represented5m,
    represented1h,
  };

  // K2 precedence — first match wins.
  let baseCause: CacheWriteCause;
  if (isFirstCall) {
    baseCause = "first-call";
  } else if (modelSwitched) {
    baseCause = "model-switch";
  } else if (compactionDetected) {
    baseCause = "compaction";
  } else {
    baseCause = "unexplained";
  }

  return { baseCause, trace };
}

/**
 * The conservative TTL-attribution overlay — independent from the K2
 * base cause (ARCH §A4). Reads the trace's represented buckets and idle
 * gap plus the current call's cache_creation buckets (the gap itself
 * is already in the trace, but the function signature accepts both
 * calls so the same input shape used by `classifyCacheWrite` flows in
 * unchanged).
 *
 * Rules — see ARCH §ClassifiedCacheWrite / §attribution:
 *   1. First-call or model-switch spike → unknown (the cause is already
 *      explained; a TTL chip would contradict it).
 *   2. Gap > every represented TTL → ttl-lapse (definitive expiry).
 *   3. Gap ≤ every represented TTL AND base cause is "unexplained" →
 *      prefix-change (the cache had time; only a prefix change could
 *      have invalidated it).
 *   4. Everything else — missing buckets, mixed buckets, malformed
 *      timestamps, partial expiry across mixed 5m/1h — → unknown.
 *
 * The function never throws and never emits NaN: a missing timestamp
 * collapses ttlGapMs to null at the trace level, which the rules below
 * map to "unknown" without further arithmetic.
 */
export function attributeCacheMiss(
  classification: ClassifiedBaseCause,
  _currentCall: ApiCall,
  previousCall: ApiCall | undefined,
): CacheMissAttribution {
  // Rule 1: K2-already-explained spikes get "unknown" (not
  // "prefix-change") so the verdict chip never claims TTL evidence
  // that contradicts the base cause.
  if (classification.baseCause === "first-call" || classification.baseCause === "model-switch") {
    return "unknown";
  }
  // Compaction spikes carry their own evidence; the overlay returns
  // unknown for the same reason — the page already labels them as
  // compaction, not TTL.
  if (classification.baseCause === "compaction") {
    return "unknown";
  }

  const { trace } = classification;

  // No usable gap → no TTL evidence.
  if (trace.ttlGapMs === null) return "unknown";

  // No represented bucket → cannot tell whether the gap is "beyond
  // the TTL" or "within the TTL". Honest unknown.
  if (!trace.represented5m && !trace.represented1h) return "unknown";

  // The max represented TTL in milliseconds. Mixed buckets (both 5m
  // and 1h non-zero) → we cannot say which bucket the gap exceeded,
  // so partial expiry is ambiguous → unknown (Rule 4).
  const representedTtlsMs: number[] = [];
  if (trace.represented5m) representedTtlsMs.push(5 * 60 * 1000);
  if (trace.represented1h) representedTtlsMs.push(60 * 60 * 1000);

  // Defensive: keep the parameter shape as `(classification, current, previous)`
  // per ARCH §API Contracts even though `_currentCall` and `previousCall`
  // are not directly read here. The trace already carries the gap and
  // the represented buckets; the calls themselves would only matter if a
  // future revision needed extra fields not in the trace.
  void previousCall;

  // Rule 2: gap > every represented TTL → definitive expiry.
  if (representedTtlsMs.every((ttl) => trace.ttlGapMs !== null && trace.ttlGapMs > ttl)) {
    return "ttl-lapse";
  }

  // Rule 3: gap within every represented TTL AND base cause is
  // unexplained → prefix change (the cache had time; only a prefix
  // change could have invalidated it).
  if (representedTtlsMs.every((ttl) => trace.ttlGapMs !== null && trace.ttlGapMs <= ttl)) {
    return "prefix-change";
  }

  // Rule 4: mixed (some TTLs exceeded, others not) → ambiguous.
  return "unknown";
}
