import type { ApiCall, Session, TierFlags, TokenUsage, Turn } from "../../shared/types.js";
import type { PricingTable } from "../metrics/measures.js";
import { priceCall, uncachedPrice } from "../metrics/measures.js";
import { resolveContextWindow } from "../metrics/model-metadata.js";
import { addUsage, emptyUsage } from "./token-usage.js";

// Per-session tier detection (architecture §4): which sidecar files exist for
// this session. Full C/B/L *parsing* (turning those files into observed
// costs) is #P4-13's job — here we only know presence, so costBasis is always
// "computed" until #P4-13 wires observed values through.
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

  // maxTurnCostComputed: max per-turn cost across all turns.
  let maxTurnCostComputed = 0;
  if (pricer) {
    for (const turn of turns) {
      let turnCost = 0;
      for (const call of turn.calls) {
        turnCost += pricer(call.usage, call.model);
      }
      if (turnCost > maxTurnCostComputed) {
        maxTurnCostComputed = turnCost;
      }
    }
  }

  // contextPctEstimated: total tokens of the last turn's last call divided by
  // that model's context window. Unknown model → undefined (not 0).
  let contextPctEstimated: number | undefined;
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.calls.length > 0) {
    const lastCall = lastTurn.calls[lastTurn.calls.length - 1];
    const ctxWindow = contextResolver
      ? contextResolver(lastCall.model)
      : resolveContextWindow(lastCall.model);
    if (ctxWindow !== null) {
      const total =
        lastTurn.usage.inputTokens +
        lastTurn.usage.outputTokens +
        lastTurn.usage.cacheReadTokens +
        lastTurn.usage.cacheCreateTokens;
      contextPctEstimated = Math.min(1, Math.max(0, total / ctxWindow));
    }
  }

  const cacheEligible = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
  const cacheHitPct = cacheEligible > 0 ? usage.cacheReadTokens / cacheEligible : 0;

  const tier: TierFlags = {
    hasCostSamples: sidecars.hasCostSamples,
    hasTurnBoundaries: sidecars.hasTurnBoundaries,
    hasCostLog: sidecars.hasCostLog,
    costBasis: "computed",
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
    usage,
    turnCount: turns.length,
    callCount: calls.length,
    costComputed,
    cacheHitPct,
    durationMs,
    // Only include optional fields when they have a meaningful non-zero value
    cacheSavingsComputed: cacheSavingsComputed > 0 ? cacheSavingsComputed : undefined,
    maxTurnCostComputed: maxTurnCostComputed > 0 ? maxTurnCostComputed : undefined,
    contextPctEstimated,
  };
}
