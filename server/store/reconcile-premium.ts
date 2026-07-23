import type { ApiCall, Turn } from "../../shared/types.js";
import type { CostLogRow, CostSample, TurnBoundary } from "../ingest/parse-premium.js";

// Premium reconciliation (#P4-13). Pure: given a session's transcript-derived
// calls + turns and its parsed C/B/L sidecar content, produce observed-value
// annotations on copies of those calls/turns plus a session-level rollup. The
// store orchestrates (calls this in `recompute` after `deriveTurns`, before
// `deriveSession`); this module reads no store state and mutates nothing it is
// given.
//
// Reconciliation model (design decisions A1-A7 in ARCH-45.md / the #P4-13 plan):
//
//   * (A1) Attribution is by TIMESTAMP, not by C's `turn`/`epoch` index fields
//     — every C line carries a `timestamp`, so one rule covers both index
//     variants. Each sample attaches to the **last call at-or-before** its
//     timestamp (C fields are emitted after a call completes, so the sample's
//     time is >= that call's); a sample earlier than every call falls back to
//     the first call.
//   * (A2) Per-field aggregation: cost SUM, lines SUM (per-sample deltas),
//     apiMs MAX per call (a call's API duration, not additive across repeated
//     samples), context_pct LAST (a point-in-time %, never summed).
//   * (A3) Turn rollup: apiMs / lines are SUMMED across the turn's calls.
//     `wallMs` upgrades to the observed turn-boundary span (`turn_end` −
//     `startedAt`) when a B boundary covers the (main-chain) turn; degrades to
//     the transcript call-span otherwise.
//   * (A4) costLogRow precedence: only consumed when C is absent. C wins
//     whenever present.
//   * (A5) wallMs baseline: `endedAt - startedAt` of the turn itself; the B
//     upgrade replaces this value when a valid boundary matches.
//   * (A6) Annotated-copy discipline: original `calls[]`/`turns[]` references
//     are kept untouched when no accumulator fires for a row, so identity-keyed
//     maps stay stable.
//   * (A7) Session rollup is computed directly from all samples (attribution-
//     invariant): `costObserved` = Σ cost_delta_usd, lines = Σ, context% =
//     the latest sample's `context_pct`. When only L is present, its
//     per-session totals stand in. When both C and L are present, **C wins**.

export interface PremiumRollup {
  /** Σ observed $ for the session (C samples, or L's session total). Undefined when neither carries a value. */
  costObserved?: number;
  /** Latest observed context-window fraction (0-1), normalized from the source percentage. */
  contextPctObserved?: number;
  /** Σ observed lines added/removed for the session. */
  linesAdded?: number;
  linesRemoved?: number;
  /**
   * #P4-14: count of C samples whose `promptId` does not match any
   * turn's `promptId` in this session (#P4-14 §4 boundary-mismatches
   * panel). A sample is checked only when both the sample and at
   * least one turn carry a non-empty `promptId`; samples missing
   * `promptId` are skipped, not counted as a mismatch, so a statusline
   * that doesn't emit the field never inflates this counter. Computed
   * alongside the per-call attribution pass in
   * `attributeSamplesToCalls`.
   */
  promptIdMismatchCount?: number;
  /**
   * #P4-14: count of C samples whose timestamp falls outside every
   * turn's `[startedAt, endedAt]` range. Mirrors the promptId-mismatch
   * check's "missing field is skipped, not counted" discipline — a
   * sample with an unparseable timestamp is neither matched nor
   * counted. Surfaced on the Data Health page §4 as "X samples sat
   * outside any turn."
   */
  unbucketedTailCount?: number;
}

export interface ReconcileInput {
  costSamples: CostSample[];
  turnBoundaries: TurnBoundary[];
  costLogRow?: CostLogRow;
}

export interface ReconcileResult {
  /** Calls annotated with per-call observed fields — the same array reference when there is nothing to reconcile. */
  calls: ApiCall[];
  /** Turns annotated with per-turn observed fields (embedding the annotated calls). */
  turns: Turn[];
  session: PremiumRollup;
}

interface CallAccumulator {
  costObserved: number;
  apiMs: number;
  linesAdded: number;
  linesRemoved: number;
  /** Timestamp (ms) of the latest sample attributed to this call, to resolve `contextPct` = LAST. */
  latestPctAt: number;
  contextPct: number;
  hasPct: boolean;
}

/** Boundary with its parsed end timestamp — pre-parsed once per reconcile so
 *  the per-turn boundary lookup is O(1) amortized via a scanning pointer. */
interface BoundaryWithMs {
  ms: number;
  boundary: TurnBoundary;
}

function parseMs(ts: string): number {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Reconcile parsed premium sidecar content into observed annotations. Returns
 * the inputs untouched (no copy) when no C/B/L content is present — the hot
 * transcript-only path stays zero-cost.
 */
export function reconcilePremium(
  calls: ApiCall[],
  turns: Turn[],
  input: ReconcileInput,
): ReconcileResult {
  const hasC = input.costSamples.length > 0;
  const hasB = input.turnBoundaries.length > 0;
  const hasL = input.costLogRow !== undefined;

  if (!hasC && !hasB && !hasL) {
    return { calls, turns, session: {} };
  }

  // --- (A1, A2) Per-call attribution (C only) ----------------------------
  const { accByCall, promptIdMismatchCount, unbucketedTailCount } = hasC
    ? attributeSamplesToCalls(calls, input.costSamples, turns)
    : {
        accByCall: new Map<ApiCall, CallAccumulator>(),
        promptIdMismatchCount: 0,
        unbucketedTailCount: 0,
      };

  // --- (A6) Annotated call copies + identity-keyed map -------------------
  const { annotatedCalls, annotatedByOriginal } = annotateCalls(calls, accByCall);

  // --- (A3, A5) Turn annotation (with B-driven wallMs upgrade) -----------
  const annotatedTurns = annotateTurns(
    turns,
    annotatedByOriginal,
    input.turnBoundaries,
    hasC,
    hasB,
  );

  // --- (A4, A7) Session rollup (attribution-invariant) -------------------
  const session = rollupSession(input.costSamples, input.costLogRow, hasC, hasL);
  if (hasC) {
    // #P4-14: surface the §4 boundary-mismatch counts only when C is
    // present (otherwise the counters stay undefined and the page
    // renders the §4 sub-card as "no premium capture observed"). The
    // counts are computed during `attributeSamplesToCalls` so the
    // attribution pass and the §4 signal share a single walk.
    session.promptIdMismatchCount = promptIdMismatchCount;
    session.unbucketedTailCount = unbucketedTailCount;
  }

  return { calls: annotatedCalls, turns: annotatedTurns, session };
}

/**
 * (A1, A2) Attribute parsed C samples to their owning ApiCall by timestamp,
 * accumulating per-call observed fields. Returns a Map keyed by ApiCall
 * identity; entries absent for calls with no attributed samples.
 *
 * #P4-14: also walks the same sample list once to compute the
 * promptId-mismatch and unbucketed-tail counts surfaced on the Data
 * Health page §4. Both checks are O(samples) over a pre-built index
 * of turn promptIds / turn time ranges, so the total cost stays
 * O(samples + turns) instead of O(samples × turns).
 */
function attributeSamplesToCalls(
  calls: ApiCall[],
  samples: CostSample[],
  turns: Turn[],
): {
  accByCall: Map<ApiCall, CallAccumulator>;
  promptIdMismatchCount: number;
  unbucketedTailCount: number;
} {
  // Pre-parse timestamps once (review P-004) instead of re-parsing on
  // every comparator call. For K=10k samples, Array.sort invokes the
  // comparator ~K·log₂K = 130k times — naive `Date.parse` in the
  // comparator means ~260k parses per sort (twice for the tie-break
  // path). Pre-parsing once into a `{ms, original, key}` tuple trades
  // K upfront parses for ~K·log₂K saved inside the sort.
  const callsWithMs = calls.map((c) => ({ call: c, ms: parseMs(c.timestamp) }));
  const sortedCalls = [...callsWithMs].sort((a, b) =>
    a.ms !== b.ms ? a.ms - b.ms : a.call.uuid.localeCompare(b.call.uuid),
  );
  const samplesWithMs = samples.map((s) => ({
    sample: s,
    ms: parseMs(s.timestamp),
    key: s.timestamp + s.sessionId,
  }));
  const sortedSamples = [...samplesWithMs].sort((a, b) =>
    a.ms !== b.ms ? a.ms - b.ms : a.key.localeCompare(b.key),
  );

  // §4 indexes — built once, reused per sample. A turn with a non-empty
  // promptId contributes to `turnPromptIds`; a turn with parseable
  // `startedAt`/`endedAt` contributes to `turnRanges`. Turns missing
  // either field are skipped from the corresponding check (matching
  // the "missing field is skipped, not counted" discipline on the
  // sample side).
  const turnPromptIds = new Set<string>();
  const turnRanges: { startMs: number; endMs: number }[] = [];
  for (const t of turns) {
    if (t.promptId) turnPromptIds.add(t.promptId);
    const startMs = parseMs(t.startedAt);
    const endMs = parseMs(t.endedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      turnRanges.push({ startMs, endMs });
    }
  }
  // Sort by startMs once for the unbucketed-tail sweep below. Without
  // this the sweep would need to compare every range against every
  // sample (review P-002) — O(samples × turns). With the sweep + a
  // max-endMs active set, the bound is O((samples + turns) · active)
  // where `active` is the typical concurrency of overlapping ranges,
  // usually 1 for non-overlapping turn timelines.
  turnRanges.sort((a, b) => a.startMs - b.startMs);
  const activeEndMs: number[] = []; // sorted descending; front is current max
  let rangeIdx = 0;

  const accByCall = new Map<ApiCall, CallAccumulator>();
  let callIdx = -1;
  let promptIdMismatchCount = 0;
  let unbucketedTailCount = 0;

  for (const sampleEntry of sortedSamples) {
    const sample = sampleEntry.sample;
    const sampleMs = sampleEntry.ms;

    // Advance to the last call whose timestamp is <= this sample's.
    while (
      callIdx + 1 < sortedCalls.length &&
      (sortedCalls[callIdx + 1]?.ms ?? Number.NEGATIVE_INFINITY) <= sampleMs
    ) {
      callIdx++;
    }
    // Fallback: a sample earlier than every call attaches to the first call.
    const target = callIdx >= 0 ? sortedCalls[callIdx]?.call : sortedCalls[0]?.call;
    if (!target) continue; // no calls at all — session rollup still counts it below
    let acc = accByCall.get(target);
    if (!acc) {
      acc = {
        costObserved: 0,
        apiMs: 0,
        linesAdded: 0,
        linesRemoved: 0,
        latestPctAt: Number.NEGATIVE_INFINITY,
        contextPct: 0,
        hasPct: false,
      };
      accByCall.set(target, acc);
    }
    acc.costObserved += sample.costDeltaUsd;
    acc.apiMs = Math.max(acc.apiMs, sample.apiDurationMs);
    acc.linesAdded += sample.linesAdded;
    acc.linesRemoved += sample.linesRemoved;
    // LAST context_pct wins; NaN-timestamp samples never displace a dated one.
    if (Number.isFinite(sampleMs) ? sampleMs >= acc.latestPctAt : !acc.hasPct) {
      acc.latestPctAt = Number.isFinite(sampleMs) ? sampleMs : acc.latestPctAt;
      acc.contextPct = sample.contextPct;
      acc.hasPct = true;
    }

    // §4 — promptId mismatch: only count when the sample carries a
    // non-empty `promptId` AND at least one turn does. Otherwise the
    // signal is undefined and the counter stays quiet.
    if (sample.promptId && turnPromptIds.size > 0 && !turnPromptIds.has(sample.promptId)) {
      promptIdMismatchCount++;
    }
    // §4 — unbucketed tail (review P-002): swept interval-stab algorithm
    // over the pre-sorted `turnRanges` + a max-endMs active set. With
    // `rangeIdx` advancing monotonically as samples come in (samples are
    // time-sorted), every range is inserted into / evicted from the
    // active set at most once, so the inner cost is O(active) per sample
    // instead of O(turns). For real sessions where overlapping turn
    // ranges are rare (main-chain + a side-agent at most), `active`
    // stays ≤ 2 — much better than the previous O(samples × turns)
    // bound that broke down on marathon sessions with 10k+ samples.
    if (Number.isFinite(sampleMs) && turnRanges.length > 0) {
      // Activate every range whose startMs ≤ sampleMs.
      while (rangeIdx < turnRanges.length) {
        const range = turnRanges[rangeIdx];
        if (range === undefined || range.startMs > sampleMs) break;
        // Insert range.endMs into the descending-sorted active set.
        let i = 0;
        while (i < activeEndMs.length) {
          const top = activeEndMs[i];
          if (top === undefined || top <= range.endMs) break;
          i++;
        }
        activeEndMs.splice(i, 0, range.endMs);
        rangeIdx++;
      }
      // Evict ranges that closed before this sample (endMs < sampleMs).
      while (activeEndMs.length > 0) {
        const top = activeEndMs[0];
        if (top === undefined || top >= sampleMs) break;
        activeEndMs.shift();
      }
      // A range covers this sample iff any active endMs ≥ sampleMs.
      // The front of the descending-sorted array IS the max, so this is
      // O(1) — exactly the algorithm's win.
      if (activeEndMs.length === 0) {
        unbucketedTailCount++;
      }
    }
  }

  return { accByCall, promptIdMismatchCount, unbucketedTailCount };
}

/**
 * (A6) Build annotated copies of calls carrying their accumulator's observed
 * fields, plus an identity-keyed Map from original → annotated ApiCall so the
 * turn pass can rewire `turn.calls` without re-running attribution.
 *
 * Calls with no accumulator keep their original reference — no allocation, and
 * the identity map reflects "this call was not touched."
 */
function annotateCalls(
  calls: ApiCall[],
  accByCall: Map<ApiCall, CallAccumulator>,
): { annotatedCalls: ApiCall[]; annotatedByOriginal: Map<ApiCall, ApiCall> } {
  const annotatedByOriginal = new Map<ApiCall, ApiCall>();
  const annotatedCalls = calls.map((call) => {
    const acc = accByCall.get(call);
    if (!acc) {
      annotatedByOriginal.set(call, call);
      return call;
    }
    const next: ApiCall = { ...call };
    next.costObserved = acc.costObserved;
    next.apiMs = acc.apiMs;
    next.linesAdded = acc.linesAdded;
    next.linesRemoved = acc.linesRemoved;
    if (acc.hasPct) next.contextPct = acc.contextPct;
    annotatedByOriginal.set(call, next);
    return next;
  });
  return { annotatedCalls, annotatedByOriginal };
}

/**
 * (A3, A5) Annotate turns with their per-turn observed rollups (when C is
 * present) and the observed wall time from a B boundary (main-chain turns
 * only). The B lookup uses a sorted-by-ms boundary array + scanning pointer
 * across turns so the total cost is O(T + B) instead of O(T × B) (review H4).
 *
 * wallMs fallback (A5): the transcript-derived call span `endedAt - startedAt`
 * when no B boundary matches — keeps main-chain turns with valid C data but
 * absent/malformed B file from leaving `wallMs` undefined (review H5).
 */
function annotateTurns(
  turns: Turn[],
  annotatedByOriginal: Map<ApiCall, ApiCall>,
  boundaries: TurnBoundary[],
  hasC: boolean,
  hasB: boolean,
): Turn[] {
  // Pre-parse boundary timestamps once outside the per-turn loop so the
  // boundary find is a constant-time indexed read, not a per-turn
  // `Date.parse(b.turnEnd)` storm.
  const boundariesWithMs: BoundaryWithMs[] = hasB
    ? [...boundaries]
        .sort((a, b) => a.turnEnd.localeCompare(b.turnEnd))
        .map((b) => ({ ms: parseMs(b.turnEnd), boundary: b }))
        .filter((bw) => Number.isFinite(bw.ms))
    : [];
  let bIdx = 0; // first boundary at-or-after the previous turn's endMs

  return turns.map((turn) => {
    const turnCalls = turn.calls.map((c) => annotatedByOriginal.get(c) ?? c);
    const next: Turn = { ...turn, calls: turnCalls };

    // (A3) Per-turn C aggregation: apiMs / lines summed across the turn's
    // calls. Only written when at least one call carries observed fields;
    // otherwise undefined means "no observed data for this turn."
    if (hasC) {
      let apiMs = 0;
      let linesAdded = 0;
      let linesRemoved = 0;
      let sawObserved = false;
      for (const c of turnCalls) {
        if (c.apiMs !== undefined) {
          apiMs += c.apiMs;
          sawObserved = true;
        }
        if (c.linesAdded !== undefined) {
          linesAdded += c.linesAdded;
          sawObserved = true;
        }
        if (c.linesRemoved !== undefined) {
          linesRemoved += c.linesRemoved;
          sawObserved = true;
        }
      }
      if (sawObserved) {
        next.apiMs = apiMs;
        next.linesAdded = linesAdded;
        next.linesRemoved = linesRemoved;
      }
    }

    // (A3, A5) Observed wall time. Match the earliest B boundary at-or-after
    // the turn's last call (scanning pointer advances across turns);
    // degrade to the transcript call span (endedAt - startedAt) when no
    // boundary matches. Main-chain turns only — sub-agent turns are not
    // covered by the Stop-hook boundary emission.
    if (!turn.isSidechain) {
      const startMs = parseMs(turn.startedAt);
      const endMs = parseMs(turn.endedAt);
      let wallMs: number | undefined;
      if (hasB && Number.isFinite(endMs)) {
        // Advance bIdx past every boundary whose turnEnd < endMs; the
        // boundary now at bIdx (if any) is the earliest at-or-after.
        while (bIdx < boundariesWithMs.length && boundariesWithMs[bIdx].ms < endMs) {
          bIdx++;
        }
        const candidate = boundariesWithMs[bIdx];
        if (candidate && Number.isFinite(startMs)) {
          const wall = candidate.ms - startMs;
          if (wall >= 0) wallMs = wall;
        }
      }
      // Fallback (A5): transcript call span when B is absent, empty, or
      // no boundary covers this turn.
      if (wallMs === undefined && Number.isFinite(startMs) && Number.isFinite(endMs)) {
        const fallback = endMs - startMs;
        if (fallback >= 0) wallMs = fallback;
      }
      if (wallMs !== undefined) next.wallMs = wallMs;
    }

    return next;
  });
}

/**
 * (A4, A7) Compute the session-level observed rollup. C wins over L
 * whenever C is present; L stands in only when C is absent.
 */
function rollupSession(
  costSamples: CostSample[],
  costLogRow: CostLogRow | undefined,
  hasC: boolean,
  hasL: boolean,
): PremiumRollup {
  const session: PremiumRollup = {};
  if (hasC) {
    let cost = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let latestPctAt = Number.NEGATIVE_INFINITY;
    let latestPct: number | undefined;
    let sawDated = false;
    for (const s of costSamples) {
      cost += s.costDeltaUsd;
      linesAdded += s.linesAdded;
      linesRemoved += s.linesRemoved;
      const ms = parseMs(s.timestamp);
      if (Number.isFinite(ms)) {
        if (ms >= latestPctAt) {
          latestPctAt = ms;
          latestPct = s.contextPct;
          sawDated = true;
        }
      } else if (!sawDated) {
        latestPct = s.contextPct;
      }
    }
    session.costObserved = cost;
    session.linesAdded = linesAdded;
    session.linesRemoved = linesRemoved;
    if (latestPct !== undefined) session.contextPctObserved = clampFraction(latestPct / 100);
  } else if (hasL && costLogRow) {
    // L stands in only when C is absent (C wins when both present).
    session.costObserved = costLogRow.costUsd;
    session.linesAdded = costLogRow.linesAdded;
    session.linesRemoved = costLogRow.linesRemoved;
    session.contextPctObserved = clampFraction(costLogRow.contextPct / 100);
  }
  return session;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
