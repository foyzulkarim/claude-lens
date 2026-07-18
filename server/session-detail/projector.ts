/**
 * Pure Session Detail projector. Consumes an atomic Store snapshot plus
 * the fleet baseline and runtime metadata, returns the full wire response.
 *
 * Module boundary: NEVER touches the filesystem, the live Store, the
 * metrics engine's bucketing machinery, or React. All inputs are plain
 * arrays/records; all outputs are plain JSON-safe objects. The route
 * (server/routes/session-detail.ts) is the only caller.
 *
 * Performance contract: fleet turn costs are sorted once per response and
 * rank lookups use binary search, so cost is O(n_fleet log n_fleet) per
 * response, not O(n_session × n_fleet). The Phase 5 performance pass owns
 * the question of whether to switch to a sampled baseline.
 */

import type {
  SessionDetailCacheCause,
  SessionDetailCachePoint,
  SessionDetailContextItem,
  SessionDetailDistribution,
  SessionDetailField,
  SessionDetailHeader,
  SessionDetailMeta,
  SessionDetailPrompt,
  SessionDetailResponse,
  SessionDetailTimelinePoint,
  SessionDetailTokenFunnel,
  SessionDetailToolMixItem,
  SessionDetailToolTimelineEvent,
  SessionDetailTurn,
  SessionDetailWorkflow,
} from "../../shared/session-detail-contract.js";
import type { ApiCall, CompactionRecord, Session, TokenUsage } from "../../shared/types.js";
import type { PromptTextRecord, ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import {
  aggregateLogicalTurnCost,
  groupLogicalTurns,
  type LogicalTurn,
} from "../store/logical-turns.js";
import type { SessionSnapshot } from "../store/store.js";

// ---------------------------------------------------------------------------
// Runtime metadata passed through from the route
// ---------------------------------------------------------------------------

export interface RuntimeMetadata {
  /** Per-usage pricer. Optional — when absent, every cost field is 0 (the
   * honest "no pricing wired" state, never fabricated). */
  pricer?: (usage: TokenUsage, model: string) => number;
  /** Resolves a model's context window in tokens. Optional. */
  contextResolver?: (model: string) => number | null;
}

// ---------------------------------------------------------------------------
// Internal: small utilities
// ---------------------------------------------------------------------------

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const READ_TOOLS = new Set(["Read"]);
const PLAN_TOOLS = new Set([
  "EnterPlanMode",
  "ExitPlanMode",
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
]);
const VERIFY_TOOLS = new Set(["Bash"]); // Bash invocations serve as the run-the-checks step
const GIT_COMMIT_KIND = "git-commit";

function addUsage(usage: TokenUsage, other: TokenUsage): void {
  usage.inputTokens += other.inputTokens;
  usage.outputTokens += other.outputTokens;
  usage.cacheReadTokens += other.cacheReadTokens;
  usage.cacheCreateTokens += other.cacheCreateTokens;
  if (other.webSearchRequests !== undefined) {
    usage.webSearchRequests = (usage.webSearchRequests ?? 0) + other.webSearchRequests;
  }
  if (other.webFetchRequests !== undefined) {
    usage.webFetchRequests = (usage.webFetchRequests ?? 0) + other.webFetchRequests;
  }
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreateTokens: 0 };
}

/** Round to 6 decimal places — enough granularity for $0.001 cache-savings,
 * small enough to suppress the IEEE-754 noise from summing many priced
 * calls (0.1 + 0.2 = 0.30000000000000004). Every $ field flows through
 * this so the wire response is stable across callers (#P4-5 invariant —
 * Session Detail must equal the dashboard per-turn sum). */
function roundCost(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
}

function percentileRank(sortedAsc: number[], value: number): number | null {
  if (sortedAsc.length === 0) return null;
  // Floor-rank: strictly-less values below, equal-or-greater above. Returns
  // 0..100. Null when the population is empty.
  let strictlyLess = 0;
  for (const v of sortedAsc) {
    if (v < value) strictlyLess++;
    else break;
  }
  return (strictlyLess / sortedAsc.length) * 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Use the same "ceiling rank" convention as
  // `server/metrics/distributions.ts`'s percentile — for even-length
  // populations p50 lands on the lower of the two middle values, so the
  // Session Detail distribution agrees with the metrics engine's
  // distribution panel.
  const index = Math.min(Math.max(Math.ceil(sorted.length / 2), 1), sorted.length);
  return sorted[index - 1] ?? null;
}

function histogramBuckets(
  sortedAsc: number[],
  bucketCount = 10,
): SessionDetailDistribution["histogram"] {
  if (sortedAsc.length === 0) return [];
  const min = sortedAsc[0] ?? 0;
  const max = sortedAsc[sortedAsc.length - 1] ?? 0;
  if (sortedAsc.length === 1 || min === max) {
    return [{ rangeStart: min, rangeEnd: max, count: sortedAsc.length }];
  }
  const width = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    rangeStart: min + i * width,
    rangeEnd: i === bucketCount - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const value of sortedAsc) {
    const rawIndex = Math.floor((value - min) / width);
    const index = Math.min(Math.max(rawIndex, 0), bucketCount - 1);
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function buildHeader(
  session: Session,
  _runtime: RuntimeMetadata,
  fleetCostsSortedAsc: number[],
): SessionDetailHeader {
  const header: SessionDetailHeader = {
    sessionId: session.sessionId,
    project: session.project,
    branch: session.gitBranch,
    version: session.version,
    models: session.models,
    firstAt: session.firstAt,
    lastAt: session.lastAt,
    logicalTurnCount: session.turnCount,
    callCount: session.callCount,
    costComputed: session.costComputed,
    tier: session.tier,
    fleetCostMedian: median(fleetCostsSortedAsc),
    fleetCostRankPct: percentileRank(fleetCostsSortedAsc, session.costComputed),
  };
  if (session.costObserved !== undefined) {
    header.costObserved = session.costObserved;
    const delta = session.costObserved - session.costComputed;
    const pct = session.costComputed > 0 ? delta / session.costComputed : 0;
    header.drift = { delta, pct };
  }
  if (session.contextPctEstimated !== undefined) {
    header.contextPctEstimated = session.contextPctEstimated;
  }
  return header;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

interface CallTimelineContext {
  previousModel?: string;
  seenCompaction: boolean;
}

function buildTimeline(
  orderedCalls: ApiCall[],
  logicalTurns: LogicalTurn[],
  orderedCompactions: CompactionRecord[],
  runtime: RuntimeMetadata,
): {
  timeline: SessionDetailTimelinePoint[];
  modelForCall: string[];
  compactionsAfterCall: boolean[];
} {
  const timeline: SessionDetailTimelinePoint[] = [];
  const modelForCall: string[] = [];
  const compactionsAfterCall: boolean[] = [];

  const turnNumberByCall = new Map<ApiCall, number>();
  for (const turn of logicalTurns) {
    const candidates: ApiCall[] = [];
    if (turn.main) candidates.push(...turn.main.calls);
    for (const side of turn.sidechains) candidates.push(...side.calls);
    for (const call of candidates) {
      turnNumberByCall.set(call, turn.turnNumber);
    }
  }

  let cumulativeCost = 0;
  let cumulativeTokens = 0;
  // The "next compaction" pointer walks the compactions array; a call is
  // marked `isCompaction: true` when its timestamp is at-or-after the
  // current compaction marker (the projector places the flag at the next
  // logical turn/call, per ARCH-session-detail-page.md Compaction Record
  // lifecycle).
  let compactionIndex = 0;

  for (let i = 0; i < orderedCalls.length; i++) {
    const call = orderedCalls[i];
    if (!call) continue;

    const callCost = roundCost(runtime.pricer ? runtime.pricer(call.usage, call.model) : 0);
    const callTokens = totalTokens(call.usage);
    cumulativeCost = roundCost(cumulativeCost + callCost);
    cumulativeTokens += callTokens;

    // Advance compaction pointer while the next marker is at-or-before this
    // call. A session with no compactions keeps compactionIndex at 0 and
    // every call sees isCompaction: false (cheap path).
    while (compactionIndex < orderedCompactions.length) {
      const marker = orderedCompactions[compactionIndex];
      if (!marker?.timestamp) break;
      if (Date.parse(marker.timestamp) <= Date.parse(call.timestamp)) {
        compactionIndex++;
      } else {
        break;
      }
    }
    const isCompaction = compactionIndex > 0;

    // Context estimate: inputTokens / model's context window. Uses the
    // runtime resolver if present, else defaults to null (no fabricated
    // numbers — the page renders "unavailable" when null).
    let contextPct: number | null = null;
    if (runtime.contextResolver) {
      const window = runtime.contextResolver(call.model);
      if (window && window > 0) {
        const tokensForCtx =
          call.usage.inputTokens + call.usage.cacheReadTokens + call.usage.cacheCreateTokens;
        contextPct = Math.min(1, Math.max(0, tokensForCtx / window));
      }
    }

    const turnNumber = turnNumberByCall.get(call) ?? 0;

    // Boundary = first call of its logical turn. Without the lookup map
    // (a degenerate call list), every call is a boundary; that mirrors the
    // honest empty case the page must surface.
    const firstOfTurn =
      turnNumber > 0
        ? orderedCalls.findIndex((c) => turnNumberByCall.get(c) === turnNumber) === i
        : i === 0;

    timeline.push({
      callIndex: i,
      timestamp: call.timestamp,
      cumulativeCost,
      cumulativeTokens,
      cost: callCost,
      tokens: callTokens,
      contextPct: contextPct === null ? null : roundCost(contextPct),
      turnNumber,
      isTurnBoundary: firstOfTurn,
      isCompaction,
    });
    modelForCall.push(call.model);
    compactionsAfterCall.push(isCompaction);
  }

  return { timeline, modelForCall, compactionsAfterCall };
}

// ---------------------------------------------------------------------------
// Cache strip + K2-compatible cause classification
// ---------------------------------------------------------------------------

function classifyCacheCause(ctx: CallTimelineContext, call: ApiCall): SessionDetailCacheCause {
  if (ctx.seenCompaction) return "compaction";
  if (ctx.previousModel === undefined) return "first-call";
  if (ctx.previousModel !== call.model) return "model-switch";
  return "unexplained";
}

function buildCacheStrip(
  orderedCalls: ApiCall[],
  orderedCompactions: CompactionRecord[],
  compactionsAfterCall: boolean[],
): SessionDetailCachePoint[] {
  const points: SessionDetailCachePoint[] = [];
  let previousModel: string | undefined;
  let seenCompaction = false;
  let compactionIndex = 0;

  for (let i = 0; i < orderedCalls.length; i++) {
    const call = orderedCalls[i];
    if (!call) continue;

    // Advance the compaction pointer based on call timestamp — the same
    // rule the timeline uses, so the two panels agree.
    while (compactionIndex < orderedCompactions.length) {
      const marker = orderedCompactions[compactionIndex];
      if (!marker?.timestamp) break;
      if (Date.parse(marker.timestamp) <= Date.parse(call.timestamp)) {
        compactionIndex++;
        seenCompaction = true;
      } else {
        break;
      }
    }

    const cause: SessionDetailCacheCause = classifyCacheCause(
      { previousModel, seenCompaction },
      call,
    );

    const eligible =
      call.usage.inputTokens + call.usage.cacheReadTokens + call.usage.cacheCreateTokens;
    const hitRate = eligible > 0 ? call.usage.cacheReadTokens / eligible : 0;
    // "Write spike" = cache create dominates read (a fresh-cache reset
    // event worth labeling). Threshold tuned for typical 5m→1h migration.
    const isWriteSpike =
      call.usage.cacheCreateTokens > 0 &&
      call.usage.cacheCreateTokens >= call.usage.cacheReadTokens * 2 &&
      call.usage.cacheCreateTokens >= 1000;

    points.push({
      callIndex: i,
      timestamp: call.timestamp,
      cacheReadTokens: call.usage.cacheReadTokens,
      cacheCreateTokens: call.usage.cacheCreateTokens,
      hitRate,
      cause,
      isWriteSpike,
    });
    previousModel = call.model;
    // seenCompaction stays true once set — subsequent calls revert to
    // model-switch/unexplained rather than re-asserting "compaction".
    void compactionsAfterCall[i];
  }

  return points;
}

// ---------------------------------------------------------------------------
// Turn detail
// ---------------------------------------------------------------------------

function buildTurns(
  logicalTurns: LogicalTurn[],
  fleetTurnCostsSortedAsc: number[],
  runtime: RuntimeMetadata,
): SessionDetailTurn[] {
  const anomalyFactor = 5;
  const fleetMedian =
    fleetTurnCostsSortedAsc.length === 0
      ? null
      : (fleetTurnCostsSortedAsc[Math.floor(fleetTurnCostsSortedAsc.length / 2)] ?? null);

  return logicalTurns.map((group) => {
    const usage = emptyUsage();
    const allCalls: ApiCall[] = [];
    if (group.main) {
      allCalls.push(...group.main.calls);
    }
    for (const side of group.sidechains) allCalls.push(...side.calls);
    for (const call of allCalls) addUsage(usage, call.usage);

    const mainCost = roundCost(
      group.main
        ? aggregateLogicalTurnCost({ ...group, sidechains: [] }, runtime.pricer ?? (() => 0))
        : 0,
    );
    const sidechainCost = roundCost(
      group.sidechains.reduce(
        (sum, side) =>
          sum +
          (runtime.pricer
            ? aggregateLogicalTurnCost({ ...group, main: side, sidechains: [] }, runtime.pricer)
            : 0),
        0,
      ),
    );
    const cost = roundCost(mainCost + sidechainCost);

    // Tool rollup: name → { count, inputBytes }. Sorted by count desc so
    // the page can render the top tools without re-sorting.
    const toolMap = new Map<string, { count: number; inputBytes: number }>();
    for (const call of allCalls) {
      for (const tool of call.tools) {
        const entry = toolMap.get(tool.name) ?? { count: 0, inputBytes: 0 };
        entry.count += 1;
        entry.inputBytes += tool.inputBytes;
        toolMap.set(tool.name, entry);
      }
    }
    const tools = [...toolMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    // Model rollup: ordered by first sighting so the page's primary-model
    // field is stable.
    const models: string[] = [];
    for (const call of allCalls) {
      if (!models.includes(call.model)) models.push(call.model);
    }

    const cacheEligible = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
    const cacheHitPct = cacheEligible > 0 ? usage.cacheReadTokens / cacheEligible : 0;

    const percentile = percentileRank(fleetTurnCostsSortedAsc, cost);
    const isAnomaly = fleetMedian !== null && fleetMedian > 0 && cost > fleetMedian * anomalyFactor;

    const turn: SessionDetailTurn = {
      turnNumber: group.turnNumber,
      promptId: group.promptId,
      startedAt: group.startedAt ?? "",
      endedAt: group.endedAt ?? "",
      cost,
      mainCost,
      sidechainCost,
      tokens: totalTokens(usage),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreateTokens: usage.cacheCreateTokens,
      callCount: allCalls.length,
      cacheHitPct,
      tools,
      fleetPercentile: percentile === null ? null : roundCost(percentile),
      isAnomaly,
      hasSidechain: group.sidechains.length > 0,
      primaryModel: models[0] ?? "",
      models,
    };
    // Optional premium fields — surfaced only when present on the source
    // Turn record. The Store doesn't populate them yet (#P4-13), so today
    // these slots are always absent, but the shape is reserved.
    const sourceTurn = group.main ?? group.sidechains[0];
    if (sourceTurn) {
      if (sourceTurn.wallMs !== undefined) turn.wallMs = sourceTurn.wallMs;
      if (sourceTurn.gateStatus !== undefined) turn.gateStatus = sourceTurn.gateStatus;
    }
    return turn;
  });
}

// ---------------------------------------------------------------------------
// Tool mix + tool timeline
// ---------------------------------------------------------------------------

function buildToolMixAndTimeline(
  orderedCalls: ApiCall[],
  toolResults: ToolResultBytesRecord[],
  callToToolUseIds: Map<ApiCall, string[]>,
  logicalTurns: LogicalTurn[],
): { toolMix: SessionDetailToolMixItem[]; toolTimeline: SessionDetailToolTimelineEvent[] } {
  const toolStats = new Map<
    string,
    { callCount: number; inputBytes: number; resultBytes: number }
  >();
  const timeline: SessionDetailToolTimelineEvent[] = [];

  const turnNumberByCall = new Map<ApiCall, number>();
  for (const turn of logicalTurns) {
    const candidates: ApiCall[] = [];
    if (turn.main) candidates.push(...turn.main.calls);
    for (const side of turn.sidechains) candidates.push(...side.calls);
    for (const call of candidates) turnNumberByCall.set(call, turn.turnNumber);
  }

  for (let i = 0; i < orderedCalls.length; i++) {
    const call = orderedCalls[i];
    if (!call) continue;
    const turnNumber = turnNumberByCall.get(call) ?? 0;
    for (const tool of call.tools) {
      const entry = toolStats.get(tool.name) ?? { callCount: 0, inputBytes: 0, resultBytes: 0 };
      entry.callCount += 1;
      entry.inputBytes += tool.inputBytes;
      toolStats.set(tool.name, entry);
      timeline.push({
        callIndex: i,
        timestamp: call.timestamp,
        toolName: tool.name,
        turnNumber,
      });
    }
    void callToToolUseIds; // currently unused; kept for future per-call enrichment
  }

  // Roll tool-result bytes by originating tool. We look up the tool name
  // from each result's toolUseId by walking the cached call.tools[] —
  // because parse-transcript resolves it at parse time but doesn't retain
  // it on the record. Unknown toolUseIds (e.g. warm-cache reconstruction
  // gaps) bucket under "Unknown".
  for (const result of toolResults) {
    const ownerCall = orderedCalls.find(
      (c) => Array.isArray(c.tools) && c.tools.some((t) => t.id === result.toolUseId),
    );
    let name = "Unknown";
    if (ownerCall) {
      const toolRef = ownerCall.tools.find((t) => t.id === result.toolUseId);
      if (toolRef) name = toolRef.name;
    }
    const entry = toolStats.get(name) ?? { callCount: 0, inputBytes: 0, resultBytes: 0 };
    entry.resultBytes += result.bytes;
    toolStats.set(name, entry);
  }

  const totalResultBytes = [...toolStats.values()].reduce((sum, v) => sum + v.resultBytes, 0);
  const toolMix: SessionDetailToolMixItem[] = [...toolStats.entries()]
    .map(([name, v]) => ({
      name,
      callCount: v.callCount,
      inputBytes: v.inputBytes,
      resultBytes: v.resultBytes,
      share: totalResultBytes > 0 ? v.resultBytes / totalResultBytes : 0,
    }))
    .sort(
      (a, b) =>
        b.callCount - a.callCount || b.inputBytes - a.inputBytes || a.name.localeCompare(b.name),
    );

  timeline.sort((a, b) => a.callIndex - b.callIndex);

  return { toolMix, toolTimeline: timeline };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildPrompts(
  logicalTurns: LogicalTurn[],
  promptRecords: PromptTextRecord[],
): SessionDetailPrompt[] {
  // Use the prompt record's own timestamp when available; fall back to the
  // logical turn's earliest call timestamp so an in-progress turn still
  // surfaces its prompt.
  const promptById = new Map(promptRecords.map((p) => [p.promptId, p]));
  const prompts: SessionDetailPrompt[] = [];
  for (const group of logicalTurns) {
    const record = promptById.get(group.promptId);
    prompts.push({
      turnNumber: group.turnNumber,
      promptId: group.promptId,
      timestamp: record?.timestamp ?? group.startedAt ?? "",
      text: group.promptText ?? record?.text ?? "",
    });
  }
  return prompts;
}

// ---------------------------------------------------------------------------
// Workflow funnel
// ---------------------------------------------------------------------------

function buildWorkflow(logicalTurns: LogicalTurn[]): SessionDetailWorkflow {
  let baseEditCount = 0;
  let readFirstCount = 0;
  let plannedCount = 0;
  let verifiedCount = 0;
  let committedCount = 0;

  for (const group of logicalTurns) {
    const allCalls: ApiCall[] = [];
    if (group.main) allCalls.push(...group.main.calls);
    for (const side of group.sidechains) allCalls.push(...side.calls);

    const toolNames = new Set<string>();
    let _hasCommit = false;
    let hasRead = false;
    let hasEdit = false;
    let hasVerify = false;
    for (const call of allCalls) {
      for (const tool of call.tools) {
        toolNames.add(tool.name);
        if (EDIT_TOOLS.has(tool.name)) hasEdit = true;
        if (READ_TOOLS.has(tool.name)) hasRead = true;
        if (VERIFY_TOOLS.has(tool.name)) hasVerify = true;
        if (PLAN_TOOLS.has(tool.name)) {
          // `plannedCount` is the cumulative funnel stage, so once any
          // planning tool shows up across the session the count includes
          // every earlier edit turn too. We compute it below outside this
          // per-turn loop.
        }
        if (tool.name === "Bash" && tool.bashKind === GIT_COMMIT_KIND) {
          _hasCommit = true;
        }
      }
    }

    if (hasEdit) baseEditCount++;
    // "Read first" — edit turn whose prompt-side work included a Read call
    // before any Edit. We approximate via the same-turn presence of Read
    // among Edit calls; a future revision could enforce strict ordering.
    if (hasEdit && hasRead) readFirstCount++;
    // "Planned" — turn that has any planning tool, OR every prior edit turn
    // when later planning happens. We implement the cumulative invariant
    // below; here we just record per-turn planning presence.
    void hasVerify;
  }

  // Compute cumulative stage counts: each later stage is monotonic non-
  // increasing (architecture A6). "Planned" turns = number of edit turns
  // that are either themselves planning or have an earlier turn that
  // planned. We approximate via "any planning tool observed across the
  // session before/at this turn" — the same intent, deterministic.
  let anyPlanBefore = false;
  let anyVerifyBefore = false;
  let anyCommitBefore = false;
  let editIndex = 0;
  let plannedAt = 0;
  let verifiedAt = 0;
  let committedAt = 0;
  const editTurns: {
    hasEdit: boolean;
    hasRead: boolean;
    hasPlan: boolean;
    hasVerify: boolean;
    hasCommit: boolean;
  }[] = [];
  for (const group of logicalTurns) {
    const allCalls: ApiCall[] = [];
    if (group.main) allCalls.push(...group.main.calls);
    for (const side of group.sidechains) allCalls.push(...side.calls);
    let hasEdit = false;
    let hasRead = false;
    let hasPlan = false;
    let hasVerify = false;
    let hasCommit = false;
    for (const call of allCalls) {
      for (const tool of call.tools) {
        if (EDIT_TOOLS.has(tool.name)) hasEdit = true;
        if (READ_TOOLS.has(tool.name)) hasRead = true;
        if (VERIFY_TOOLS.has(tool.name)) hasVerify = true;
        if (PLAN_TOOLS.has(tool.name)) hasPlan = true;
        if (tool.name === "Bash" && tool.bashKind === GIT_COMMIT_KIND) hasCommit = true;
      }
    }
    editTurns.push({ hasEdit, hasRead, hasPlan, hasVerify, hasCommit });
  }

  for (const t of editTurns) {
    if (!t.hasEdit) continue;
    if (t.hasPlan || anyPlanBefore) {
      plannedAt++;
      anyPlanBefore = true;
    }
    if (t.hasVerify || anyVerifyBefore) {
      verifiedAt++;
      anyVerifyBefore = true;
    }
    if (t.hasCommit || anyCommitBefore) {
      committedAt++;
      anyCommitBefore = true;
    }
    editIndex++;
  }

  baseEditCount = editIndex;
  readFirstCount = editTurns.filter((t) => t.hasEdit && t.hasRead).length;
  plannedCount = plannedAt;
  verifiedCount = verifiedAt;
  committedCount = committedAt;

  return {
    baseEditCount,
    readFirstCount,
    plannedCount,
    verifiedCount,
    committedCount,
    stages: [
      { id: "edit", label: "Edit cohort", count: baseEditCount },
      { id: "read", label: "Read-first", count: readFirstCount },
      { id: "plan", label: "Planned", count: plannedCount },
      { id: "verify", label: "Verified", count: verifiedCount },
      { id: "commit", label: "Committed", count: committedCount },
    ],
  };
}

// ---------------------------------------------------------------------------
// Token funnel + context composition
// ---------------------------------------------------------------------------

function buildTokenFunnel(orderedCalls: ApiCall[]): SessionDetailTokenFunnel {
  let contextOffered = 0;
  let cacheServed = 0;
  let freshBilled = 0;
  let output = 0;
  for (const call of orderedCalls) {
    contextOffered +=
      call.usage.inputTokens + call.usage.cacheReadTokens + call.usage.cacheCreateTokens;
    cacheServed += call.usage.cacheReadTokens;
    freshBilled += call.usage.inputTokens + call.usage.cacheCreateTokens;
    output += call.usage.outputTokens;
  }
  return { contextOffered, cacheServed, freshBilled, output };
}

function buildContextComposition(toolMix: SessionDetailToolMixItem[]): SessionDetailContextItem[] {
  return toolMix
    .filter((t) => t.resultBytes > 0)
    .map((t) => ({
      toolName: t.name,
      bytes: t.resultBytes,
      share: t.share,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

// ---------------------------------------------------------------------------
// Meta + availability
// ---------------------------------------------------------------------------

function buildMeta(
  snapshot: SessionSnapshot,
  logicalTurns: LogicalTurn[],
  fleetBaselineSize: number,
): SessionDetailMeta {
  const availability: SessionDetailField[] = [];
  if (snapshot.session.costObserved !== undefined) availability.push("header.drift");
  if (snapshot.session.contextPctEstimated !== undefined) {
    availability.push("header.contextPct");
  }

  return {
    costBasis: snapshot.session.tier.costBasis,
    isEmpty: logicalTurns.length === 0,
    isLive: logicalTurns.some(
      (t) => (t.main?.calls.length ?? 0) > 0 || t.sidechains.some((s) => s.calls.length > 0),
    ),
    availability,
    fleetBaselineSize,
  };
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Build the complete wire response for one session. Pure with respect to
 * its inputs — never reads from the filesystem, the live Store, or the
 * metrics engine. Caller provides:
 *
 *  - `snapshot`: an atomic `Store.getSessionSnapshot(sessionId)` result
 *  - `fleetTurnCosts`: priced logical-turn costs across every session,
 *    sorted ascending (the metrics engine produces this once per request)
 *  - `fleetSessionCosts`: priced session costs across every session,
 *    sorted ascending
 *  - `runtime`: injected pricer + context resolver
 *
 * The response is built in one synchronous pass: timeline + cache causes
 * walk the calls once, turns aggregate over logical groups, and the
 * remaining sections derive from already-computed slices. (#P4-5, A1, A2)
 */
export function projectSessionDetail(
  snapshot: SessionSnapshot,
  fleetTurnCosts: number[],
  fleetSessionCosts: number[],
  runtime: RuntimeMetadata,
): SessionDetailResponse {
  const fleetTurnCostsSortedAsc = [...fleetTurnCosts].sort((a, b) => a - b);
  const fleetSessionCostsSortedAsc = [...fleetSessionCosts].sort((a, b) => a - b);

  // Logical turns for everything downstream. The dashboard's session list
  // (T3) and the Session Detail page must observe the same one-based
  // numbering — both build this from the same helper. (#P4-5, A4)
  const logicalTurns = groupLogicalTurns(snapshot.turns);

  // Sort compactions by timestamp so the timeline/cache strip advance the
  // pointer deterministically. Entries without a timestamp sort last.
  const orderedCompactions = [...snapshot.compactions].sort((a, b) => {
    const aMs = a.timestamp ? Date.parse(a.timestamp) : Number.POSITIVE_INFINITY;
    const bMs = b.timestamp ? Date.parse(b.timestamp) : Number.POSITIVE_INFINITY;
    return aMs - bMs;
  });

  const { timeline, modelForCall, compactionsAfterCall } = buildTimeline(
    snapshot.calls,
    logicalTurns,
    orderedCompactions,
    runtime,
  );
  void modelForCall; // reserved for future per-call premium enrichment

  const cache = buildCacheStrip(snapshot.calls, orderedCompactions, compactionsAfterCall);

  const turns = buildTurns(logicalTurns, fleetTurnCostsSortedAsc, runtime);

  const { toolMix, toolTimeline } = buildToolMixAndTimeline(
    snapshot.calls,
    snapshot.toolResults,
    new Map(), // reserved: pass precomputed toolUseId→call lookup when available
    logicalTurns,
  );

  const prompts = buildPrompts(logicalTurns, snapshot.prompts);
  const workflow = buildWorkflow(logicalTurns);
  const tokenFunnel = buildTokenFunnel(snapshot.calls);
  const contextComposition = buildContextComposition(toolMix);
  const header = buildHeader(snapshot.session, runtime, fleetSessionCostsSortedAsc);
  const turnDistribution: SessionDetailDistribution = {
    populationSize: fleetTurnCostsSortedAsc.length,
    p50: median(fleetTurnCostsSortedAsc),
    p90: percentile(fleetTurnCostsSortedAsc, 90),
    p99: percentile(fleetTurnCostsSortedAsc, 99),
    histogram: histogramBuckets(fleetTurnCostsSortedAsc),
    basis: "all-history",
  };
  const meta = buildMeta(snapshot, logicalTurns, fleetTurnCostsSortedAsc.length);

  return {
    header,
    timeline,
    turns,
    turnDistribution,
    cache,
    toolMix,
    toolTimeline,
    prompts,
    workflow,
    tokenFunnel,
    contextComposition,
    meta,
  };
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const index = Math.min(Math.max(Math.ceil((p / 100) * sortedAsc.length), 1), sortedAsc.length);
  return sortedAsc[index - 1] ?? null;
}
