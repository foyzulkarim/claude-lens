/**
 * Cache Lab analysis — the pure, Store-independent sibling of the metrics
 * engine. Takes plain calls/turns/sessions plus a `CacheLabQuery` and a
 * pricing table; returns the bounded `CacheLabAnalysis` shape the HTTP
 * route serializes back to the client. Mirrors `metrics/engine.ts`'s
 * "plain arrays in, plain objects out" contract so test fixtures can
 * drive the analyzer end-to-end without a live Store.
 *
 * Architecture references:
 *   §ClassifiedCacheWrite — every event carries the K2 cause, TTL
 *     attribution, classifier trace, and per-event economics.
 *   §API Contracts — analyzeCacheLab is the single entry point; the
 *     HTTP route does nothing but validate, snapshot, and delegate.
 *   §Decision A5 — bust loss = cacheCreateTokens ×
 *     max(cacheCreateRate - cacheReadRate, 0) / 1_000_000.
 *   §Decision A6 — classify complete logical streams before applying
 *     range/categorical filters so a call's previous-call context is
 *     never lost to a request boundary.
 */

import type {
  BaselinePoint,
  CacheLabAnalysis,
  CacheLabQuery,
  CacheWriteCause,
  ClassifiedCacheWrite,
  ContextGrowthCurve,
  ContextGrowthPoint,
  ContextGrowthSection,
  GalleryItem,
  InvalidationCostPoint,
  MissAttributionSummary,
  MissAttributionVerdict,
  TtlMix,
} from "../../shared/cache-lab-contract.js";
import { CACHE_LAB_LIMITS } from "../../shared/cache-lab-contract.js";
import type { Dimension, Grain } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import { bucketStart, enumerateBuckets } from "../metrics/grain.js";
import type { PricingTable } from "../metrics/measures.js";
import { attributeCacheMiss, classifyCacheWrite, partitionCacheStreams } from "./classifier.js";

/**
 * Bounded top-K selection: keeps only the best `k` items by `compare`
 * (ascending comparator; smallest-first survives) via sorted-insertion
 * into a capped buffer, instead of sorting the entire population. For
 * fleet-scale inputs with a small fixed cap (gallery: 50, context
 * curves: 24) this is O(n·k) with a small constant instead of
 * O(n log n) over the whole set.
 */
function topK<T>(items: T[], k: number, compare: (a: T, b: T) => number): T[] {
  if (items.length <= k) {
    return [...items].sort(compare);
  }
  const result: T[] = [];
  for (const item of items) {
    if (result.length === k && compare(item, result[result.length - 1]) >= 0) continue;
    let lo = 0;
    let hi = result.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compare(result[mid], item) > 0) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    result.splice(lo, 0, item);
    if (result.length > k) result.pop();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The single Store-independent input shape — the analyzer never reaches
 * back into the Store, so tests can compose a snapshot from fixture
 * lines without booting a Server.
 */
export interface AnalysisInput {
  calls: ApiCall[];
  turns: Turn[];
  sessions: Session[];
  pricing: PricingTable;
}

// ---------------------------------------------------------------------------
// Filter / range helpers
// ---------------------------------------------------------------------------

function parseTimestampMs(value: string): number | null {
  if (value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function callInRange(call: ApiCall, fromMs: number, toMs: number): boolean {
  const ts = parseTimestampMs(call.timestamp);
  if (ts === null) return false;
  return ts >= fromMs && ts <= toMs;
}

function callMatchesChip(
  call: ApiCall,
  dim: Dimension,
  allowed: ReadonlyArray<string | number>,
): boolean {
  switch (dim) {
    case "project":
      return allowed.map(String).includes(call.cwd);
    case "model":
      return allowed.map(String).includes(call.model);
    case "gitBranch":
      return allowed.map(String).includes(call.gitBranch);
    case "host":
      // No per-call host field yet (dimensions.ts synthesizes "default").
      // Only honor the chip if the user opts in to the constant value.
      return allowed.map(String).includes("default");
    case "version":
    case "entrypoint":
    case "time":
      return true;
    case "sidechain":
      return call.isSidechain === (allowed[0] === "sidechain");
    case "tool":
      // Multi-valued: any overlap qualifies, matching metrics/dimensions.ts.
      return call.tools.some((t) => allowed.map(String).includes(t.name));
    case "gateStatus":
      return true;
    default: {
      const _unhandled: never = dim;
      return true;
    }
  }
}

function callMatchesFilters(call: ApiCall, filters: CacheLabQuery["filters"]): boolean {
  if (!filters) return true;
  for (const [key, allowed] of Object.entries(filters)) {
    if (!allowed || allowed.length === 0) continue;
    if (!callMatchesChip(call, key as Dimension, allowed)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stream classification (full-history, before range/filter)
// ---------------------------------------------------------------------------

/**
 * Builds the full ClassifiedCacheWrite list for a (sessionId, streamKey)
 * bucket by walking every call in chronological order, classifying any
 * spike, and applying the TTL overlay. This walks the entire stream
 * regardless of the request's range — decision A6 — so a spike at the
 * edge of a date boundary still sees the correct previous-call context.
 *
 * Returns one record per spike; non-spike calls are dropped from the
 * output but contribute to the trace (their cacheRead tokens feed the
 * compaction ratio of later spikes).
 */
function classifyStream(stream: ApiCall[]): ClassifiedCacheWrite[] {
  const out: ClassifiedCacheWrite[] = [];
  for (let i = 0; i < stream.length; i++) {
    const current = stream[i];
    if (!current) continue;
    const classified = classifyCacheWrite(stream, i);
    if (!classified) continue;
    const previous = i > 0 ? stream[i - 1] : undefined;
    const attribution = attributeCacheMiss(classified, current, previous);
    out.push({
      sessionId: current.sessionId,
      callId: current.uuid,
      messageId: current.messageId,
      promptId: current.promptId,
      turnIndex: undefined, // filled in by the call→turn join below
      streamKey: streamKeyOf(current),
      timestamp: current.timestamp,
      model: current.model,
      cacheCreateTokens: current.usage.cacheCreateTokens,
      baseCause: classified.baseCause,
      attribution,
      trace: classified.trace,
      bustLossComputed: null, // filled in after pricing + bust accounting
      sessionNetComputed: null,
      sessionNetNegative: null,
    });
  }
  return out;
}

/** Mirrors `partitionCacheStreams`'s internal key derivation so the
 * ClassifiedCacheWrite's `streamKey` matches the bucket string the
 * analyzer uses to address the stream. */
function streamKeyOf(call: ApiCall): string {
  if (call.isSidechain && typeof call.agentId === "string" && call.agentId.length > 0) {
    return call.agentId;
  }
  return "main";
}

// ---------------------------------------------------------------------------
// Economics
// ---------------------------------------------------------------------------

/**
 * Bust-loss dollar estimate for one classified event:
 *   cacheCreateTokens × max(cacheCreateRate - cacheReadRate, 0) / 1_000_000
 *
 * The conservative delta from a stable-cache read to a full rewrite.
 * Returns null when the scoped model isn't priced — a partial
 * `pricingComplete` would otherwise be misleading.
 */
function bustLossFor(classified: ClassifiedCacheWrite, pricing: PricingTable): number | null {
  const rate = pricing[classified.model];
  if (!rate) return null;
  const delta = Math.max(rate.cacheCreate - rate.cacheRead, 0);
  return (classified.cacheCreateTokens * delta) / 1_000_000;
}

/**
 * Actual cost of one call at its model's pricing. Uses `priceUsage`'s
 * single-source formula so Cache Lab never disagrees with the Store or
 * `/api/metrics` about a per-token rate.
 */
function actualCostFor(call: ApiCall, pricing: PricingTable): number | null {
  const rate = pricing[call.model];
  if (!rate) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
  return (
    (inputTokens * rate.input +
      outputTokens * rate.output +
      cacheReadTokens * rate.cacheRead +
      cacheCreateTokens * rate.cacheCreate) /
    1_000_000
  );
}

/**
 * Counterfactual: what the call would have cost if every cache read
 * had been priced at the input rate instead. Mirrors
 * `measures.uncachedPrice` — duplicated here so Cache Lab can stay
 * Store-independent in tests and so a future pricing tweak (e.g. a new
 * token category) only needs to land in measures.ts.
 */
function uncachedCostFor(call: ApiCall, pricing: PricingTable): number | null {
  const rate = pricing[call.model];
  if (!rate) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = call.usage;
  return (
    ((inputTokens + cacheReadTokens) * rate.input +
      outputTokens * rate.output +
      cacheCreateTokens * rate.cacheCreate) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------
// Attribution verdict
// ---------------------------------------------------------------------------

function rollupAttributionVerdict(summary: {
  ttlLapse: number;
  prefixChange: number;
  unknown: number;
  total: number;
}): MissAttributionVerdict {
  if (summary.total === 0) return "no-events";
  if (summary.ttlLapse > 0 && summary.prefixChange > 0) return "mixed";
  if (summary.ttlLapse > 0) return "ttl-lapse";
  if (summary.prefixChange > 0) return "prefix-change";
  // Only `unknown` events (or none in attribution categories). This
  // covers the case where every classified spike was a first-call or
  // model-switch (they land on `unknown` because the overlay returns
  // it for already-explained causes per classifier.ts Rule 1) or the
  // unpriced/missing-bucket spikes — none of which point at a real TTL
  // or prefix-change.
  return "insufficient-evidence";
}

// ---------------------------------------------------------------------------
// TTL mix
// ---------------------------------------------------------------------------

/**
 * Reconciles 5m + 1h + unknown == cacheCreateTokens per call (and per
 * fleet). When the upstream fields are missing, the entire write lands
 * on `unknownTokens` so the page can show a real-but-unknown share
 * without fabricating split numbers.
 */
function computeTtlMix(calls: ApiCall[]): TtlMix {
  let m5 = 0;
  let h1 = 0;
  let unknown = 0;
  for (const call of calls) {
    const c5 = call.usage.cacheCreate5m ?? 0;
    const c1 = call.usage.cacheCreate1h ?? 0;
    const bothMissing =
      call.usage.cacheCreate5m === undefined && call.usage.cacheCreate1h === undefined;
    const tokens = call.usage.cacheCreateTokens;
    if (bothMissing) {
      unknown += tokens;
    } else {
      m5 += c5;
      h1 += c1;
      // If both fields are present but don't sum to the total (a
      // theoretical upstream oddity), the remainder still counts as
      // unknown so 5m + 1h + unknown == total.
      const remainder = Math.max(0, tokens - c5 - c1);
      unknown += remainder;
    }
  }
  return { ephemeral5mTokens: m5, ephemeral1hTokens: h1, unknownTokens: unknown };
}

// ---------------------------------------------------------------------------
// Baseline weight trend (median of first nonzero main-chain cache writes)
// ---------------------------------------------------------------------------

interface BaselineInputs {
  calls: ApiCall[];
  turns: Turn[];
  grain: Grain;
  rangeMs: { from: number; to: number };
}

/**
 * Per session, finds the first main-chain call with cacheCreateTokens > 0
 * — that single value is the session's "baseline" (system prompt +
 * CLAUDE.md + MCP overhead proxy). Per occupied grain bucket we return
 * the median of every session's baseline value and the sample count.
 * Buckets with zero samples stay empty (`medianTokens: null`) rather
 * than zero-filling a false claim.
 */
function computeBaselineTrend({ calls, grain, rangeMs }: BaselineInputs): {
  grain: Grain;
  points: BaselinePoint[];
} {
  // Group calls by sessionId, then pick the first main-chain call with
  // a positive cacheCreateTokens, sorted by timestamp.
  const bySession = new Map<string, ApiCall[]>();
  for (const call of calls) {
    if (call.isSidechain) continue;
    const bucket = bySession.get(call.sessionId) ?? [];
    bucket.push(call);
    bySession.set(call.sessionId, bucket);
  }

  const baselineByBucket = new Map<number, number[]>();
  for (const sessionCalls of bySession.values()) {
    const sorted = [...sessionCalls].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = sorted.find((c) => c.usage.cacheCreateTokens > 0);
    if (!first) continue;
    const ts = parseTimestampMs(first.timestamp);
    if (ts === null) continue;
    if (ts < rangeMs.from || ts > rangeMs.to) continue;
    const bucket = bucketStart(ts, grain);
    let arr = baselineByBucket.get(bucket);
    if (!arr) {
      arr = [];
      baselineByBucket.set(bucket, arr);
    }
    arr.push(first.usage.cacheCreateTokens);
  }

  const points: BaselinePoint[] = [];
  for (const bucket of enumerateBuckets(
    { from: new Date(rangeMs.from).toISOString(), to: new Date(rangeMs.to).toISOString() },
    grain,
  )) {
    const samples = baselineByBucket.get(bucket);
    if (!samples || samples.length === 0) {
      points.push({
        t: new Date(bucket).toISOString(),
        medianTokens: null,
        sampleCount: 0,
      });
      continue;
    }
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    const median =
      samples.length % 2 === 0
        ? ((samples[mid - 1] ?? 0) + (samples[mid] ?? 0)) / 2
        : (samples[mid] ?? 0);
    points.push({
      t: new Date(bucket).toISOString(),
      medianTokens: median,
      sampleCount: samples.length,
    });
  }

  return { grain, points };
}

// ---------------------------------------------------------------------------
// Invalidation cost trend
// ---------------------------------------------------------------------------

interface InvalidationCostInputs {
  events: ClassifiedCacheWrite[];
  grain: Grain;
  rangeMs: { from: number; to: number };
}

/**
 * Per grain bucket, sums bust loss across the three K2 invalidation
 * causes (model-switch, compaction, unexplained). First-call spikes are
 * excluded (a session's first cache write cannot be an invalidation —
 * there's no prior cache to bust). Buckets with no contributing events
 * still render so the chart's x-axis stays dense; per-cause values
 * become `null` whenever the scoped model needed for that cause is
 * unpriced.
 *
 * Accumulator semantics per cause:
 *   `undefined` → no event contributed yet → render as null
 *   `number`    → sum of contributing events with priced models
 *   `null`      → poisoned by an unpriced contributing event (stays
 *                  null even if a later priced event would otherwise
 *                  sum to a number — decision A5: bucket nullability
 *                  is conservative)
 */
function computeInvalidationCostTrend({ events, grain, rangeMs }: InvalidationCostInputs): {
  grain: Grain;
  points: InvalidationCostPoint[];
} {
  interface BucketAccumulator {
    modelSwitch: number | null | undefined;
    compaction: number | null | undefined;
    unexplained: number | null | undefined;
  }
  const sums = new Map<number, BucketAccumulator>();

  function addToBucket(bucket: number, cause: CacheWriteCause, amount: number | null) {
    let entry = sums.get(bucket);
    if (!entry) {
      entry = { modelSwitch: undefined, compaction: undefined, unexplained: undefined };
      sums.set(bucket, entry);
    }
    const key: keyof BucketAccumulator =
      cause === "model-switch"
        ? "modelSwitch"
        : cause === "compaction"
          ? "compaction"
          : "unexplained";
    const current = entry[key];
    if (current === null) return; // already poisoned
    if (amount === null) {
      entry[key] = null;
      return;
    }
    entry[key] = (current ?? 0) + amount;
  }

  for (const event of events) {
    if (event.baseCause === "first-call") continue;
    const ts = parseTimestampMs(event.timestamp);
    if (ts === null) continue;
    if (ts < rangeMs.from || ts > rangeMs.to) continue;
    const bucket = bucketStart(ts, grain);
    addToBucket(bucket, event.baseCause, event.bustLossComputed);
  }

  const points: InvalidationCostPoint[] = [];
  for (const bucket of enumerateBuckets(
    { from: new Date(rangeMs.from).toISOString(), to: new Date(rangeMs.to).toISOString() },
    grain,
  )) {
    const entry = sums.get(bucket);
    points.push({
      t: new Date(bucket).toISOString(),
      modelSwitch: entry?.modelSwitch ?? null,
      compaction: entry?.compaction ?? null,
      unexplained: entry?.unexplained ?? null,
    });
  }
  return { grain, points };
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

/**
 * Newest-first bounded gallery. Total + truncated surface the full
 * population so the page can render "showing 50 of N" rather than
 * implying completeness.
 */
function buildGallery(
  events: ClassifiedCacheWrite[],
  totalUnfiltered: number,
): {
  items: GalleryItem[];
  total: number;
  truncated: boolean;
} {
  const newestFirst = topK(events, CACHE_LAB_LIMITS.GALLERY_MAX_ITEMS, (a, b) =>
    b.timestamp.localeCompare(a.timestamp),
  );
  const items = newestFirst.map(toGalleryItem);
  return {
    items,
    total: totalUnfiltered,
    truncated: totalUnfiltered > items.length,
  };
}

function toGalleryItem(event: ClassifiedCacheWrite): GalleryItem {
  return {
    sessionId: event.sessionId,
    callId: event.callId,
    messageId: event.messageId,
    promptId: event.promptId,
    turnIndex: event.turnIndex,
    streamKey: event.streamKey,
    timestamp: event.timestamp,
    model: event.model,
    cacheCreateTokens: event.cacheCreateTokens,
    baseCause: event.baseCause,
    attribution: event.attribution,
    bustLossComputed: event.bustLossComputed,
  };
}

// ---------------------------------------------------------------------------
// Context growth (token-estimated, main-chain per-turn max input)
// ---------------------------------------------------------------------------

interface ContextGrowthInputs {
  turns: Turn[];
  calls: ApiCall[];
  rangeMs: { from: number; to: number };
}

/**
 * For every main-chain session in range, builds a curve of one point
 * per turn (the largest input token count seen in any call of that
 * turn). Sorts all candidate sessions by peak input descending and
 * keeps the top `CONTEXT_MAX_CURVES`; the total + truncated fields
 * disclose the rest. The basis is always "token-estimated" today —
 * observed values land as a separate variant under #P4-13.
 */
function computeContextGrowth({
  turns,
  calls,
  rangeMs,
}: ContextGrowthInputs): ContextGrowthSection {
  // Index calls by session to filter to main-chain later.
  const callsBySession = new Map<string, ApiCall[]>();
  for (const call of calls) {
    if (call.isSidechain) continue;
    const bucket = callsBySession.get(call.sessionId) ?? [];
    bucket.push(call);
    callsBySession.set(call.sessionId, bucket);
  }

  const candidates: ContextGrowthCurve[] = [];
  const seenSessions = new Set<string>();
  for (const turn of turns) {
    if (turn.isSidechain) continue;
    if (seenSessions.has(turn.sessionId)) continue;
    seenSessions.add(turn.sessionId);

    const sessionCalls = callsBySession.get(turn.sessionId) ?? [];
    // Only consider the session if at least one of its main-chain calls
    // falls inside the requested range.
    const inRange = sessionCalls.some((c) => {
      const ts = parseTimestampMs(c.timestamp);
      return ts !== null && ts >= rangeMs.from && ts <= rangeMs.to;
    });
    if (!inRange) continue;

    // Index this session's main-chain calls by turn so we can pull the
    // max input per turn.
    const callsByTurn = new Map<string, ApiCall[]>();
    for (const call of sessionCalls) {
      const bucket = callsByTurn.get(turn.promptId) ?? [];
      bucket.push(call);
      callsByTurn.set(turn.promptId, bucket);
    }
    // Derive this session's own turns (main-chain only) from its calls.
    // We can't use `turns` directly because it spans all sessions; walk
    // the sessionCalls to find distinct turn prompts in chronological
    // order.
    const sortedSessionCalls = [...sessionCalls].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const orderedPrompts: string[] = [];
    const seenPrompts = new Set<string>();
    for (const call of sortedSessionCalls) {
      const prompt = call.promptId;
      if (!prompt || seenPrompts.has(prompt)) continue;
      seenPrompts.add(prompt);
      orderedPrompts.push(prompt);
    }

    const points: ContextGrowthPoint[] = [];
    let turnIndex = 0;
    for (const promptId of orderedPrompts) {
      const turnCalls = callsByTurn.get(promptId) ?? [];
      if (turnCalls.length === 0) continue;
      let maxInput = 0;
      let representativeTimestamp = "";
      for (const call of turnCalls) {
        if (Number.isFinite(call.usage.inputTokens) && call.usage.inputTokens > maxInput) {
          maxInput = call.usage.inputTokens;
        }
        if (representativeTimestamp === "" || call.timestamp > representativeTimestamp) {
          representativeTimestamp = call.timestamp;
        }
      }
      if (maxInput <= 0) continue;
      points.push({
        turnIndex,
        timestamp: representativeTimestamp,
        inputTokens: maxInput,
      });
      turnIndex++;
    }
    if (points.length === 0) continue;
    candidates.push({ sessionId: turn.sessionId, points });
  }

  // Keep only the top CONTEXT_MAX_CURVES by peak input tokens so the
  // page's "biggest context" sessions surface even when the fleet has
  // more sessions in range than the cap. Peaks are precomputed once
  // per candidate rather than recomputed on every comparison.
  const total = candidates.length;
  const peaks = new Map<ContextGrowthCurve, number>();
  for (const candidate of candidates) {
    peaks.set(candidate, Math.max(...candidate.points.map((p) => p.inputTokens)));
  }
  const trimmed = topK(
    candidates,
    CACHE_LAB_LIMITS.CONTEXT_MAX_CURVES,
    (a, b) => (peaks.get(b) ?? 0) - (peaks.get(a) ?? 0),
  );
  return {
    curves: trimmed,
    total,
    truncated: total > trimmed.length,
    basis: "token-estimated",
  };
}

// ---------------------------------------------------------------------------
// Top-level analyzer
// ---------------------------------------------------------------------------

/**
 * One synchronous Cache Lab analysis. The route (T3) is responsible for
 * validating the query shape, snapshotting the Store, and injecting
 * runtime pricing — this function is intentionally narrow.
 */
export function analyzeCacheLab(input: AnalysisInput, query: CacheLabQuery): CacheLabAnalysis {
  const fromMs = parseTimestampMs(query.range.from);
  const toMs = parseTimestampMs(query.range.to);
  if (fromMs === null || toMs === null || fromMs > toMs) {
    // Defensive — the route's parser should have rejected this, but if
    // a future caller bypasses the validator we return an empty analysis
    // rather than throwing or fabricating zeros.
    return emptyAnalysis(query.grain);
  }
  const rangeMs = { from: fromMs, to: toMs };

  // 1. Partition streams from the FULL fleet (decision A6: classify
  //    complete logical streams before filtering).
  const streams = partitionCacheStreams(input.calls);

  // 2. Classify every stream in full; collect every classified event.
  const allEvents: ClassifiedCacheWrite[] = [];
  for (const stream of streams.values()) {
    allEvents.push(...classifyStream(stream));
  }

  const callsById = new Map<string, ApiCall>();
  for (const call of input.calls) {
    callsById.set(`${call.sessionId}::${call.uuid}`, call);
  }
  const scopedCalls = input.calls.filter(
    (call) => callInRange(call, fromMs, toMs) && callMatchesFilters(call, query.filters),
  );

  // 3. Apply range + categorical filters to events for INCLUSION in
  //    the response. (Classification already happened; this is purely
  //    "which events the user asked to see".)
  const filteredEvents = allEvents.filter((event) => {
    const ts = parseTimestampMs(event.timestamp);
    if (ts === null) return false;
    if (ts < fromMs || ts > toMs) return false;
    const call = callsById.get(`${event.sessionId}::${event.callId}`);
    if (!call) return false;
    return callMatchesFilters(call, query.filters);
  });

  // 4. Build call → turn map so we can fill turnIndex on each event.
  const callToTurn = new Map<ApiCall, Turn>();
  for (const turn of input.turns) {
    for (const call of turn.calls) {
      callToTurn.set(call, turn);
    }
  }

  // 5. Compute per-event bust loss + per-session net cache benefit.
  //    Pricing completeness is bucketed: any unpriced model in the
  //    scoped set collapses dollar fields to null while token panels
  //    stay populated.
  const pricingComplete = computePricingComplete(scopedCalls, input.pricing);
  for (const event of filteredEvents) {
    event.bustLossComputed = bustLossFor(event, input.pricing);
  }
  // Session-level net = (sum of savings for sessions in scope) - (sum
  // of bust loss for sessions in scope). Computed per session below,
  // then projected back onto each event.
  const sessionNet = computeSessionNets(
    scopedCalls,
    filteredEvents,
    input.pricing,
    rangeMs,
    query.filters,
  );
  const sessionNetNegative = new Map<string, boolean | null>();
  for (const event of filteredEvents) {
    const net = sessionNet.get(event.sessionId);
    event.sessionNetComputed = net ?? null;
    if (!sessionNetNegative.has(event.sessionId)) {
      sessionNetNegative.set(event.sessionId, net === undefined ? null : (net ?? 0) < 0);
    }
    event.sessionNetNegative = sessionNetNegative.get(event.sessionId) ?? null;
  }

  // Fill turnIndex on each event from the call → turn join. The
  // callToTurn map is keyed by ApiCall reference; we look up via
  // sessionId + uuid since filteredEvents holds only denormalized
  // primitives.
  for (const event of filteredEvents) {
    const call = callsById.get(`${event.sessionId}::${event.callId}`);
    if (!call) continue;
    const turn = callToTurn.get(call);
    if (turn) event.turnIndex = turn.calls.indexOf(call);
  }

  // 6. Roll-ups.
  const attribution = rollupAttribution(filteredEvents);
  const ttlMix = computeTtlMix(scopedCalls);
  const baseline = computeBaselineTrend({
    calls: scopedCalls,
    turns: input.turns,
    grain: query.grain,
    rangeMs,
  });
  const invalidationCost = computeInvalidationCostTrend({
    events: filteredEvents,
    grain: query.grain,
    rangeMs,
  });

  // 7. Economics — totals over the filtered set.
  const economics = computeEconomics(
    scopedCalls,
    filteredEvents,
    sessionNet,
    sessionNetNegative,
    input.pricing,
    pricingComplete,
  );

  // 8. Gallery: total is the unfiltered classified count for the same
  //    scope (first-call excluded from busts but counted in gallery
  //    per the contract — first-call is still a labeled event). The
  //    bound is CACHE_LAB_LIMITS.GALLERY_MAX_ITEMS.
  const galleryFilteredTotal = filteredEvents.length;
  const gallery = buildGallery(filteredEvents, galleryFilteredTotal);

  // 9. Context growth — token-estimated, main-chain per-turn max.
  const contextGrowth = computeContextGrowth({
    turns: input.turns,
    calls: scopedCalls,
    rangeMs,
  });

  return {
    economics,
    attribution,
    ttlMix,
    baseline,
    invalidationCost,
    gallery,
    contextGrowth,
  };
}

// ---------------------------------------------------------------------------
// Internal — economics + rollups
// ---------------------------------------------------------------------------

function emptyAnalysis(grain: Grain): CacheLabAnalysis {
  return {
    economics: {
      actualCost: 0,
      cacheSavings: 0,
      uncachedCost: 0,
      bustLoss: 0,
      netBenefit: 0,
      bustCount: 0,
      netNegativeSessionCount: 0,
      pricingComplete: true,
    },
    attribution: {
      ttlLapseCount: 0,
      prefixChangeCount: 0,
      unknownCount: 0,
      verdict: "no-events",
    },
    ttlMix: { ephemeral5mTokens: 0, ephemeral1hTokens: 0, unknownTokens: 0 },
    baseline: { grain, points: [] },
    invalidationCost: { grain, points: [] },
    gallery: { items: [], total: 0, truncated: false },
    contextGrowth: { curves: [], total: 0, truncated: false, basis: "token-estimated" },
  };
}

function computePricingComplete(calls: ApiCall[], pricing: PricingTable): boolean {
  for (const call of calls) {
    if (!pricing[call.model]) return false;
  }
  return true;
}

function computeSessionNets(
  calls: ApiCall[],
  events: ClassifiedCacheWrite[],
  pricing: PricingTable,
  rangeMs: { from: number; to: number },
  filters: CacheLabQuery["filters"],
): Map<string, number | undefined> {
  // For each session in the scoped call set, sum (uncached - actual)
  // over every in-range call and subtract the in-range bust loss. If
  // any contributing model is unpriced, mark the session as undefined
  // (signals "couldn't compute") and let the caller surface null.
  const inRange = calls.filter(
    (c) => callInRange(c, rangeMs.from, rangeMs.to) && callMatchesFilters(c, filters),
  );
  const sessionSavings = new Map<string, number | null>();
  for (const call of inRange) {
    const actual = actualCostFor(call, pricing);
    const uncached = uncachedCostFor(call, pricing);
    if (actual === null || uncached === null) {
      if (!sessionSavings.has(call.sessionId)) sessionSavings.set(call.sessionId, null);
      continue;
    }
    const previous = sessionSavings.get(call.sessionId);
    const next = (previous ?? 0) + (uncached - actual);
    if (previous !== null) sessionSavings.set(call.sessionId, next);
  }

  // Bust loss is computed from filteredEvents (already range+filter
  // scoped). Sum per session.
  const sessionBust = new Map<string, number | null>();
  for (const event of events) {
    if (event.bustLossComputed === null) {
      if (!sessionBust.has(event.sessionId)) sessionBust.set(event.sessionId, null);
      continue;
    }
    const previous = sessionBust.get(event.sessionId);
    const next = (previous ?? 0) + event.bustLossComputed;
    if (previous !== null) sessionBust.set(event.sessionId, next);
  }

  const result = new Map<string, number | undefined>();
  for (const call of inRange) {
    if (result.has(call.sessionId)) continue;
    const savings = sessionSavings.get(call.sessionId);
    const bust = sessionBust.get(call.sessionId) ?? 0;
    if (savings === null || savings === undefined) {
      result.set(call.sessionId, undefined);
      continue;
    }
    result.set(call.sessionId, savings - bust);
  }
  return result;
}

function computeEconomics(
  scopedCalls: ApiCall[],
  events: ClassifiedCacheWrite[],
  sessionNet: Map<string, number | undefined>,
  sessionNetNegative: Map<string, boolean | null>,
  pricing: PricingTable,
  pricingComplete: boolean,
): CacheLabAnalysis["economics"] {
  if (!pricingComplete) {
    // Per ARCH §A5: if any scoped model is unpriced, financial claims
    // are null; token panels stay populated. Bust count remains
    // available because it doesn't depend on pricing.
    let bustCount = 0;
    let bustLoss: number | null = 0;
    for (const event of events) {
      if (event.baseCause === "first-call") continue;
      bustCount++;
      if (event.bustLossComputed !== null && bustLoss !== null) {
        bustLoss += event.bustLossComputed;
      } else {
        bustLoss = null;
      }
    }
    let netNegativeSessionCount = 0;
    for (const negative of sessionNetNegative.values()) {
      if (negative === true) netNegativeSessionCount++;
    }
    return {
      actualCost: null,
      cacheSavings: null,
      uncachedCost: null,
      bustLoss,
      netBenefit: null,
      bustCount,
      netNegativeSessionCount,
      pricingComplete: false,
    };
  }

  let actualCost = 0;
  let uncachedCost = 0;
  for (const call of scopedCalls) {
    const actual = actualCostFor(call, pricing);
    const uncached = uncachedCostFor(call, pricing);
    if (actual !== null) actualCost += actual;
    if (uncached !== null) uncachedCost += uncached;
  }
  const cacheSavings = uncachedCost - actualCost;

  let bustLoss = 0;
  let bustCount = 0;
  for (const event of events) {
    if (event.baseCause === "first-call") continue;
    bustCount++;
    if (event.bustLossComputed !== null) bustLoss += event.bustLossComputed;
  }

  let netBenefit = 0;
  let netNegativeSessionCount = 0;
  for (const net of sessionNet.values()) {
    if (net === undefined || net === null) continue;
    netBenefit += net;
    if (net < 0) netNegativeSessionCount++;
  }

  return {
    actualCost,
    cacheSavings,
    uncachedCost,
    bustLoss,
    netBenefit,
    bustCount,
    netNegativeSessionCount,
    pricingComplete: true,
  };
}

function rollupAttribution(events: ClassifiedCacheWrite[]): MissAttributionSummary {
  let ttlLapse = 0;
  let prefixChange = 0;
  let unknown = 0;
  for (const event of events) {
    if (event.attribution === "ttl-lapse") ttlLapse++;
    else if (event.attribution === "prefix-change") prefixChange++;
    else unknown++;
  }
  return {
    ttlLapseCount: ttlLapse,
    prefixChangeCount: prefixChange,
    unknownCount: unknown,
    verdict: rollupAttributionVerdict({
      ttlLapse,
      prefixChange,
      unknown,
      total: events.length,
    }),
  };
}
