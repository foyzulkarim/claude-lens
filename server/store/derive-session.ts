import type { ApiCall, Session, TierFlags, TokenUsage, Turn } from "../../shared/types.js";
import type { PricingTable } from "../metrics/measures.js";
import { priceCall, uncachedPrice } from "../metrics/measures.js";
import { resolveContextWindow } from "../metrics/model-metadata.js";
import { aggregateLogicalTurnCost, groupLogicalTurns } from "./logical-turns.js";
import type { PremiumRollup } from "./reconcile-premium.js";
import { addUsage, emptyUsage } from "./token-usage.js";

// Per-session tier detection (architecture §4): which sidecar files exist for
// this session. Presence of a C (`.cost.jsonl`) or L (`cost-log.jsonl`) sidecar
// flips `costBasis` to "observed"; the observed *values* are reconciled by
// `reconcile-premium.ts` and threaded in via the `premium` rollup (#P4-13).
export interface SessionSidecarFlags {
  hasCostSamples: boolean;
  hasTurnBoundaries: boolean;
  hasCostLog: boolean;
}

// Pricing ships in #P2-8. Until it's injected, costComputed is 0 rather than
// fabricated — a session with real usage and $0 cost is a visible, honest
// "not priced yet" state, not silently wrong.
export type Pricer = (usage: TokenUsage, model: string) => number;

/** Resolves the context window (in tokens) for a model, or null if unknown. */
export type ContextResolver = (model: string) => number | null;

export function deriveSession(
  sessionId: string,
  calls: ApiCall[],
  turns: Turn[],
  sidecars: SessionSidecarFlags,
  pricer?: Pricer,
  pricing?: PricingTable,
  contextResolver?: ContextResolver,
  host?: string,
  /** Observed values reconciled from C/B/L sidecars (#P4-13). Absent for transcript-only sessions. */
  premium?: PremiumRollup,
): Session {
  const usage = emptyUsage();
  const models = new Set<string>();
  let firstAt = "";
  let lastAt = "";
  let project = "";
  let entrypoint = "";
  let gitBranch = "";
  let version = "";
  let costComputed = 0;

  for (const call of calls) {
    addUsage(usage, call.usage);
    if (call.model) models.add(call.model);
    if (firstAt === "" || call.timestamp < firstAt) firstAt = call.timestamp;
    if (lastAt === "" || call.timestamp > lastAt) lastAt = call.timestamp;
    if (call.cwd) project = call.cwd;
    if (call.entrypoint) entrypoint = call.entrypoint;
    if (call.gitBranch) gitBranch = call.gitBranch;
    if (call.version) version = call.version;
    if (pricer) costComputed += pricer(call.usage, call.model);
  }

  // cacheSavingsComputed = sum over calls of (uncached cost - actual cost).
  // Unpriced model → treat as $0 savings (honest unknown).
  let cacheSavingsComputed = 0;
  let hasUnpricedModel = false;
  if (pricing) {
    for (const call of calls) {
      const uncached = uncachedPrice(call, pricing);
      if (uncached === null) {
        hasUnpricedModel = true;
        break;
      }
      const actual = priceCall(call, pricing);
      cacheSavingsComputed += uncached - actual;
    }
    if (hasUnpricedModel) cacheSavingsComputed = 0;
  }

  // maxTurnCostComputed: max per-logical-turn cost across the session. The
  // logical grouping folds sidechain segments into their parent prompt so
  // a sidechain-heavy turn doesn't double-count against the metric
  // (Session Detail, the dashboard session list, and the metrics turn
  // distribution all share this view). (#P4-5, A4)
  let maxTurnCostComputed = 0;
  if (pricer) {
    const groups = groupLogicalTurns(turns);
    for (const group of groups) {
      const groupCost = aggregateLogicalTurnCost(group, pricer);
      if (groupCost > maxTurnCostComputed) {
        maxTurnCostComputed = groupCost;
      }
    }
  }

  // contextPctEstimated: that of the LAST CALL (by timestamp) over its own
  // model's context window. Review #12 / CQ5: pre-fix used the last turn's
  // aggregate `usage` (summed across every call in that turn), which in a
  // tool-loop turn double-counts overlapping token usage and clamps healthy
  // contexts at 100%. Using that single call's own usage against its own
  // model window is the documented intent. We pick the latest by timestamp
  // (not array position) so an out-of-order derive input — e.g. one from a
  // warm-cache reconstruction or a partial tail — still resolves to the
  // correct most-recent call.
  let contextPctEstimated: number | undefined;
  let latestCall: ApiCall | undefined;
  for (const call of calls) {
    if (!latestCall || call.timestamp > latestCall.timestamp) {
      latestCall = call;
    }
  }
  if (latestCall) {
    const ctxWindow = contextResolver
      ? contextResolver(latestCall.model)
      : resolveContextWindow(latestCall.model);
    if (ctxWindow !== null) {
      const { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens } = latestCall.usage;
      const total = inputTokens + outputTokens + cacheReadTokens + cacheCreateTokens;
      contextPctEstimated = Math.min(1, Math.max(0, total / ctxWindow));
    }
  }

  const cacheEligible = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
  const cacheHitPct = cacheEligible > 0 ? usage.cacheReadTokens / cacheEligible : 0;

  // costBasis is "observed" whenever a C or L capture file is present for the
  // session (architecture §4: "'observed' when C/L present"). Presence — not
  // whether a $ value happened to be captured — is the tier signal; an
  // empty-but-present cost file still marks the session observed (#P4-13).
  const tier: TierFlags = {
    hasCostSamples: sidecars.hasCostSamples,
    hasTurnBoundaries: sidecars.hasTurnBoundaries,
    hasCostLog: sidecars.hasCostLog,
    costBasis: sidecars.hasCostSamples || sidecars.hasCostLog ? "observed" : "computed",
  };

  const durationMs =
    firstAt !== "" && lastAt !== "" ? Date.parse(lastAt) - Date.parse(firstAt) : undefined;

  return {
    sessionId,
    lineageId: sessionId,
    project,
    entrypoint,
    models: [...models],
    gitBranch,
    version,
    tier,
    firstAt,
    lastAt,
    // Real host (#P4-15, ARCH-settings-local-store.md): resolved by the Store
    // from the session's originating scan root, via the live `hostLabels`
    // map (root path -> label). `server/metrics/dimensions.ts` reads this
    // same field now instead of independently synthesizing a constant
    // (review #13's drift risk — see ARCH decision A7).
    host: host ?? "unlabeled",
    usage,
    // Logical turn count — groups sidechain segments under their parent
    // prompt so Session Detail, dashboard session-list traces, and the
    // metrics turn count agree on "one turn = one user prompt". (#P4-5, A4)
    turnCount: groupLogicalTurns(turns).length,
    callCount: calls.length,
    costComputed,
    cacheHitPct,
    durationMs,
    // Optional fields: key the "unavailable" sentinel off pricing/pricer
    // presence, NOT off whether the value happens to be > 0 (review #2). A
    // fully-priced session with genuinely zero cache savings is a real
    // measured fact and must round-trip as `0`, not be silently rewritten
    // to "unavailable" — the project invariant is "0 means measured zero,
    // undefined means unavailable", and conflating the two would make a
    // priced session indistinguishable from one where pricing was never
    // wired up.
    cacheSavingsComputed: pricing ? cacheSavingsComputed : undefined,
    maxTurnCostComputed: pricer ? maxTurnCostComputed : undefined,
    contextPctEstimated,
    // Observed values reconciled from C/B/L sidecars (#P4-13). Each stays
    // undefined for transcript-only sessions, preserving the "undefined =
    // unavailable" invariant; `costObserved` being set is what lights up the
    // Session Detail drift badge and the Sessions-table observed-$ column.
    costObserved: premium?.costObserved,
    linesAdded: premium?.linesAdded,
    linesRemoved: premium?.linesRemoved,
    contextPctObserved: premium?.contextPctObserved,
  };
}
