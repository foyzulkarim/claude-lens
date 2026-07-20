import type { ApiCall, Turn } from "../../shared/types.js";
import type { CostLogRow, CostSample, TurnBoundary } from "../ingest/parse-premium.js";

// Premium reconciliation (#P4-13). Pure: given a session's transcript-derived
// calls + turns and its parsed C/B/L sidecar content, produce observed-value
// annotations on copies of those calls/turns plus a session-level rollup. The
// store orchestrates (calls this in `recompute` after `deriveTurns`, before
// `deriveSession`); this module reads no store state and mutates nothing it is
// given.
//
// Reconciliation model (design decisions D1-D3, D7 in the #P4-13 plan):
//
//   * Attribution is by TIMESTAMP, not by C's `turn`/`epoch` index fields —
//     every C line carries a `timestamp`, so one rule covers both index
//     variants. Each sample attaches to the **last call at-or-before** its
//     timestamp (C fields are emitted after a call completes, so the sample's
//     time is >= that call's); a sample earlier than every call falls back to
//     the first call.
//   * Per-field aggregation: cost SUM, lines SUM (per-sample deltas), apiMs
//     MAX per call (a call's API duration, not additive across repeated
//     samples), context_pct LAST (a point-in-time %, never summed).
//   * Turn rollup: apiMs / lines are SUMMED across the turn's calls. `wallMs`
//     upgrades to the observed turn-boundary span (`turn_end` − `startedAt`)
//     when a B boundary covers the (main-chain) turn; degrades to the call
//     span otherwise.
//   * Session rollup is computed directly from all samples (attribution-
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

  // --- Per-call attribution (C only) --------------------------------------
  const accByCall = new Map<ApiCall, CallAccumulator>();
  if (hasC) {
    const sortedCalls = [...calls].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const sortedSamples = [...input.costSamples].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    let callIdx = -1;
    for (const sample of sortedSamples) {
      // Advance to the last call whose timestamp is <= this sample's.
      while (
        callIdx + 1 < sortedCalls.length &&
        (sortedCalls[callIdx + 1]?.timestamp ?? "") <= sample.timestamp
      ) {
        callIdx++;
      }
      // Fallback: a sample earlier than every call attaches to the first call.
      const target = callIdx >= 0 ? sortedCalls[callIdx] : sortedCalls[0];
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
      const sampleMs = parseMs(sample.timestamp);
      // LAST context_pct wins; NaN-timestamp samples never displace a dated one.
      if (Number.isFinite(sampleMs) ? sampleMs >= acc.latestPctAt : !acc.hasPct) {
        acc.latestPctAt = Number.isFinite(sampleMs) ? sampleMs : acc.latestPctAt;
        acc.contextPct = sample.contextPct;
        acc.hasPct = true;
      }
    }
  }

  // --- Annotated call copies ----------------------------------------------
  const annotatedCalls = calls.map((call) => {
    const acc = accByCall.get(call);
    if (!acc) return call;
    const next: ApiCall = { ...call };
    next.costObserved = acc.costObserved;
    next.apiMs = acc.apiMs;
    next.linesAdded = acc.linesAdded;
    next.linesRemoved = acc.linesRemoved;
    if (acc.hasPct) next.contextPct = acc.contextPct;
    return next;
  });
  const annotatedByOriginal = new Map<ApiCall, ApiCall>();
  calls.forEach((call, i) => {
    const a = annotatedCalls[i];
    if (a) annotatedByOriginal.set(call, a);
  });

  // --- Turn annotation ----------------------------------------------------
  const boundaries = hasB
    ? [...input.turnBoundaries].sort((a, b) => a.turnEnd.localeCompare(b.turnEnd))
    : [];

  const annotatedTurns = turns.map((turn) => {
    const turnCalls = turn.calls.map((c) => annotatedByOriginal.get(c) ?? c);
    const next: Turn = { ...turn, calls: turnCalls };

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

    // Observed wall time from a B boundary (main-chain turns only — the
    // Stop-hook fires on the main thread, not per sub-agent). Match the
    // earliest boundary at-or-after the turn's last call; degrade to the
    // transcript call-span when none matches.
    if (hasB && !turn.isSidechain) {
      const startMs = parseMs(turn.startedAt);
      const endMs = parseMs(turn.endedAt);
      const boundary = boundaries.find((b) => {
        const bMs = parseMs(b.turnEnd);
        return Number.isFinite(bMs) && Number.isFinite(endMs) && bMs >= endMs;
      });
      if (boundary && Number.isFinite(startMs)) {
        const wall = parseMs(boundary.turnEnd) - startMs;
        if (wall >= 0) next.wallMs = wall;
      }
    }

    return next;
  });

  // --- Session rollup (attribution-invariant) -----------------------------
  const session: PremiumRollup = {};
  if (hasC) {
    let cost = 0;
    let linesAdded = 0;
    let linesRemoved = 0;
    let latestPctAt = Number.NEGATIVE_INFINITY;
    let latestPct: number | undefined;
    let sawDated = false;
    for (const s of input.costSamples) {
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
  } else if (hasL && input.costLogRow) {
    // L stands in only when C is absent (C wins when both present).
    const row = input.costLogRow;
    session.costObserved = row.costUsd;
    session.linesAdded = row.linesAdded;
    session.linesRemoved = row.linesRemoved;
    session.contextPctObserved = clampFraction(row.contextPct / 100);
  }

  return { calls: annotatedCalls, turns: annotatedTurns, session };
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
