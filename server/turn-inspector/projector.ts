/**
 * Pure Turn Inspector projector (#P4-6, ARCH-turn-inspector-page.md).
 * Consumes an atomic Store snapshot plus the fleet turn-cost baseline and
 * runtime metadata, returns the full wire response for one logical turn.
 *
 * Module boundary: NEVER touches the filesystem, the live Store, or React —
 * identical rule to `server/session-detail/projector.ts`, whose small pure
 * utilities and per-session timeline/cache-cause derivation this module
 * reuses rather than re-implementing (so Turn Inspector's numbers can never
 * silently disagree with Session Detail's for the same session). The route
 * (`server/routes/turn-inspector.ts`) is the only caller.
 */

import type {
  TurnInspectorCachePoint,
  TurnInspectorNav,
  TurnInspectorResponse,
  TurnInspectorSidechain,
  TurnInspectorSummary,
  TurnInspectorWaterfallCall,
} from "../../shared/turn-inspector-contract.js";
import type { ApiCall } from "../../shared/types.js";
import {
  addUsage,
  buildCacheStrip,
  buildTimeline,
  emptyUsage,
  percentileRank,
  type RuntimeMetadata,
  roundCost,
  totalTokens,
} from "../session-detail/projector.js";
import {
  aggregateLogicalTurnCost,
  groupLogicalTurns,
  type LogicalTurn,
} from "../store/logical-turns.js";
import type { SessionSnapshot } from "../store/store.js";

export type { RuntimeMetadata };

function orderedTurnCalls(group: LogicalTurn): ApiCall[] {
  const calls: ApiCall[] = [];
  if (group.main) calls.push(...group.main.calls);
  for (const side of group.sidechains) calls.push(...side.calls);
  return calls.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const ANOMALY_FACTOR = 5;

function buildSummary(
  snapshot: SessionSnapshot,
  group: LogicalTurn,
  totalTurns: number,
  cost: number,
  usage: ReturnType<typeof emptyUsage>,
  callCount: number,
  fleetTurnCostsSortedAsc: number[],
): TurnInspectorSummary {
  const allCalls = orderedTurnCalls(group);
  const models: string[] = [];
  for (const call of allCalls) {
    if (!models.includes(call.model)) models.push(call.model);
  }
  const fleetMedianIndex = Math.floor(fleetTurnCostsSortedAsc.length / 2);
  const fleetMedian =
    fleetTurnCostsSortedAsc.length === 0
      ? null
      : (fleetTurnCostsSortedAsc[fleetMedianIndex] ?? null);
  // Contract: percentile is null when the fleet baseline has fewer than
  // two entries — a single sample has no rank among itself.
  const percentile =
    fleetTurnCostsSortedAsc.length < 2 ? null : percentileRank(fleetTurnCostsSortedAsc, cost);

  const summary: TurnInspectorSummary = {
    sessionId: snapshot.session.sessionId,
    turnNumber: group.turnNumber,
    totalTurns,
    promptId: group.promptId,
    ...(group.promptText !== undefined ? { promptText: group.promptText } : {}),
    startedAt: group.startedAt ?? "",
    endedAt: group.endedAt ?? "",
    cost,
    tokens: totalTokens(usage),
    callCount,
    models,
    primaryModel: models[0] ?? "",
    fleetPercentile: percentile === null ? null : roundCost(percentile),
    isAnomaly: fleetMedian !== null && fleetMedian > 0 && cost > fleetMedian * ANOMALY_FACTOR,
  };
  // Observed premium timing (#P4-13), reconciled onto the source Turn records
  // by `reconcile-premium.ts` (mirrors `server/session-detail/projector.ts`).
  // `apiMs` sums across the logical turn's segments; observed `wallMs` comes
  // from the main segment's turn-boundary. Absent unless C/B was attributed —
  // the api-vs-wall split then renders partial rather than fabricated.
  let apiMs = 0;
  let sawApiMs = false;
  for (const seg of [...(group.main ? [group.main] : []), ...group.sidechains]) {
    if (seg.apiMs !== undefined) {
      apiMs += seg.apiMs;
      sawApiMs = true;
    }
  }
  if (sawApiMs) summary.apiMs = apiMs;
  if (group.main?.wallMs !== undefined) summary.wallMs = group.main.wallMs;
  return summary;
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

function buildWaterfall(
  group: LogicalTurn,
  runtime: RuntimeMetadata,
): { calls: TurnInspectorWaterfallCall[] } {
  const allCalls = orderedTurnCalls(group);
  const firstAt = allCalls[0] ? Date.parse(allCalls[0].timestamp) : 0;

  const calls: TurnInspectorWaterfallCall[] = allCalls.map((call, index) => {
    const callCost = roundCost(runtime.pricer ? runtime.pricer(call.usage, call.model) : 0);
    const timestampMs = Date.parse(call.timestamp);
    const offsetMs =
      Number.isFinite(timestampMs) && Number.isFinite(firstAt) ? timestampMs - firstAt : 0;
    const waterfallCall: TurnInspectorWaterfallCall = {
      callIndex: index,
      messageId: call.messageId,
      timestamp: call.timestamp,
      offsetMs: offsetMs >= 0 ? offsetMs : 0,
      tokens: totalTokens(call.usage),
      cost: callCost,
      tools: call.tools.map((t) => ({ name: t.name, inputBytes: t.inputBytes })),
      isSidechain: call.isSidechain,
      cacheReadTokens: call.usage.cacheReadTokens,
      cacheCreateTokens: call.usage.cacheCreateTokens,
    };
    // Observed per-call API duration (#P4-13) reconciled onto the ApiCall.
    if (call.apiMs !== undefined) waterfallCall.apiMs = call.apiMs;
    return waterfallCall;
  });

  return { calls };
}

// ---------------------------------------------------------------------------
// Cache narrative
// ---------------------------------------------------------------------------

function narrativeFor(point: TurnInspectorCachePoint): string | undefined {
  if (point.cause === "first-call") return undefined;
  if (point.isWriteSpike) {
    const kTokens = Math.round(point.cacheCreateTokens / 100) / 10;
    return `${kTokens}k tokens re-written — cause: ${point.cause}`;
  }
  if (point.cause === "unexplained") {
    return "Cache hit dropped with no model switch or compaction — likely prefix churn";
  }
  return undefined;
}

function buildCacheNarrative(
  snapshot: SessionSnapshot,
  group: LogicalTurn,
  runtime: RuntimeMetadata,
): TurnInspectorCachePoint[] {
  // Reuse the whole-session timeline/cache-cause derivation so a call's
  // classified cause can never disagree between Session Detail's Cache
  // Strip and Turn Inspector's Cache Narrative for the same call.
  const logicalTurns = groupLogicalTurns(snapshot.turns);
  const orderedCompactions = [...snapshot.compactions].sort((a, b) => {
    const aMs = a.timestamp ? Date.parse(a.timestamp) : Number.POSITIVE_INFINITY;
    const bMs = b.timestamp ? Date.parse(b.timestamp) : Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });
  const { timeline, compactionsAfterCall } = buildTimeline(
    snapshot.calls,
    logicalTurns,
    orderedCompactions,
    runtime,
  );
  const cachePoints = buildCacheStrip(snapshot.calls, compactionsAfterCall);

  const turnCallUuids = new Set(orderedTurnCalls(group).map((c) => c.uuid));
  const points: TurnInspectorCachePoint[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const point = timeline[i];
    const cache = cachePoints[i];
    const call = snapshot.calls[point?.callIndex ?? -1];
    if (!point || !cache || !call) continue;
    if (!turnCallUuids.has(call.uuid)) continue;
    const entry: TurnInspectorCachePoint = {
      callIndex: point.callIndex,
      cause: cache.cause,
      isWriteSpike: cache.isWriteSpike,
      hitRate: cache.hitRate,
      cacheReadTokens: cache.cacheReadTokens,
      cacheCreateTokens: cache.cacheCreateTokens,
    };
    const narrative = narrativeFor(entry);
    if (narrative !== undefined) entry.narrative = narrative;
    points.push(entry);
  }
  return points;
}

// ---------------------------------------------------------------------------
// Sidechain breakdown
// ---------------------------------------------------------------------------

function buildSidechainBreakdown(
  group: LogicalTurn,
  runtime: RuntimeMetadata,
): TurnInspectorResponse["sidechainBreakdown"] {
  const pricer = runtime.pricer ?? (() => 0);
  const mainCost = roundCost(
    group.main ? aggregateLogicalTurnCost({ ...group, sidechains: [] }, pricer) : 0,
  );
  const mainUsage = emptyUsage();
  for (const call of group.main?.calls ?? []) addUsage(mainUsage, call.usage);

  const sidechains: TurnInspectorSidechain[] = group.sidechains.map((side) => {
    const cost = roundCost(
      aggregateLogicalTurnCost({ ...group, main: side, sidechains: [] }, pricer),
    );
    const usage = emptyUsage();
    for (const call of side.calls) addUsage(usage, call.usage);
    const firstModel = side.calls[0]?.model ?? "";
    return {
      ...(side.calls[0]?.agentId !== undefined ? { agentId: side.calls[0].agentId } : {}),
      cost,
      tokens: totalTokens(usage),
      callCount: side.calls.length,
      primaryModel: firstModel,
    };
  });

  return {
    mainCost,
    mainTokens: totalTokens(mainUsage),
    mainCallCount: group.main?.calls.length ?? 0,
    sidechains,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Build the complete wire response for one logical turn, or `null` when the
 * requested `turnNumber` doesn't exist in this session (the route maps
 * that to a 404 "turn not found").
 */
export function projectTurnInspector(
  snapshot: SessionSnapshot,
  turnNumber: number,
  fleetTurnCosts: number[],
  runtime: RuntimeMetadata,
): TurnInspectorResponse | null {
  const logicalTurns = groupLogicalTurns(snapshot.turns);
  const group = logicalTurns.find((t) => t.turnNumber === turnNumber);
  if (!group) return null;

  const fleetTurnCostsSortedAsc = [...fleetTurnCosts].sort((a, b) => a - b);

  const pricer = runtime.pricer ?? (() => 0);
  const cost = roundCost(aggregateLogicalTurnCost(group, pricer));
  const usage = emptyUsage();
  const allCalls = orderedTurnCalls(group);
  for (const call of allCalls) addUsage(usage, call.usage);

  const summary = buildSummary(
    snapshot,
    group,
    logicalTurns.length,
    cost,
    usage,
    allCalls.length,
    fleetTurnCostsSortedAsc,
  );
  const waterfall = buildWaterfall(group, runtime);
  const cacheNarrative = buildCacheNarrative(snapshot, group, runtime);
  const sidechainBreakdown = buildSidechainBreakdown(group, runtime);

  const prev = logicalTurns.find((t) => t.turnNumber === turnNumber - 1);
  const next = logicalTurns.find((t) => t.turnNumber === turnNumber + 1);
  const nav: TurnInspectorNav = {
    prevTurnNumber: prev ? prev.turnNumber : null,
    nextTurnNumber: next ? next.turnNumber : null,
    totalTurns: logicalTurns.length,
  };

  const availability: TurnInspectorResponse["meta"]["availability"] = [];
  if (summary.wallMs !== undefined) availability.push("summary.wallMs");
  if (summary.apiMs !== undefined) availability.push("summary.apiMs");

  return {
    summary,
    waterfall,
    cacheNarrative,
    sidechainBreakdown,
    nav,
    meta: {
      costBasis: snapshot.session.tier.costBasis,
      availability,
      fleetBaselineSize: fleetTurnCostsSortedAsc.length,
    },
  };
}
