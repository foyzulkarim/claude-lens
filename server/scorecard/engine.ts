import type {
  CacheCreationEntry,
  CacheScorecardCore,
  WasteEventKind,
} from "../../shared/scorecard-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";
import {
  attributeCacheMiss,
  classifyCacheWrite,
  MAIN_STREAM_KEY,
  partitionCacheStreams,
} from "../cache/classifier.js";
import { groupLogicalTurns } from "../store/logical-turns.js";

function buildTurnNumberByCall(turns: Turn[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const logicalTurn of groupLogicalTurns(turns)) {
    if (logicalTurn.main) {
      for (const call of logicalTurn.main.calls) result.set(call.messageId, logicalTurn.turnNumber);
    }
    for (const sidechain of logicalTurn.sidechains) {
      for (const call of sidechain.calls) result.set(call.messageId, logicalTurn.turnNumber);
    }
  }
  return result;
}

function eventKind(attribution: CacheCreationEntry["attribution"]): WasteEventKind {
  if (attribution === "prefix-change") return "prefix-bust";
  if (attribution === "ttl-lapse") return "idle-expiry";
  return "unattributed";
}

function stabilizeTimestampTies(stream: ApiCall[]): void {
  let start = 0;
  while (start < stream.length) {
    let end = start + 1;
    while (end < stream.length && stream[end]?.timestamp === stream[start]?.timestamp) end += 1;
    if (end - start > 1) {
      const ordered = stream.slice(start, end).sort((left, right) => {
        const byMessage = left.messageId.localeCompare(right.messageId);
        return byMessage !== 0 ? byMessage : left.uuid.localeCompare(right.uuid);
      });
      stream.splice(start, ordered.length, ...ordered);
    }
    start = end;
  }
}

/**
 * Epoch high-water-mark bookkeeping threaded across the main-stream fold
 * (#124 review finding #5 — extracted so `computeScorecard` reads as a
 * thin fold over `classifyCall`'s per-call results instead of a single
 * 115-line loop body). `established`/`epoch` are read-and-written by every
 * call (including read-only ones); `warmupByPromptModel` backs the
 * duplicated-warmup detector (A11) across epochs.
 */
interface DecompositionState {
  established: number;
  epoch: number;
  warmupByPromptModel: Map<string, { epoch: number; tokens: number }>;
}

function createDecompositionState(): DecompositionState {
  return { established: 0, epoch: 0, warmupByPromptModel: new Map() };
}

/**
 * Classifies and decomposes one call in the ordered main stream, mutating
 * `state`'s epoch/high-water-mark bookkeeping in place. Returns the ledger
 * entry for a positive write, or `null` for a read-only call (`create <= 0`)
 * — only the high-water mark advances for those, per A2.
 */
function classifyCall(
  stream: ApiCall[],
  index: number,
  current: ApiCall,
  turnNumberByCall: Map<string, number>,
  state: DecompositionState,
): CacheCreationEntry | null {
  const previous = stream[index - 1];
  const create = current.usage.cacheCreateTokens;
  const read = current.usage.cacheReadTokens;
  const footprint = read + create;

  if (create <= 0) {
    if (previous && current.model !== previous.model) {
      state.epoch += 1;
      state.established = footprint;
    } else {
      state.established = Math.max(state.established, footprint);
    }
    return null;
  }

  const classification = classifyCacheWrite(stream, index, { threshold: 0 });
  const baseCause = classification?.baseCause ?? "unexplained";
  const attribution = classification
    ? attributeCacheMiss(classification, current, previous)
    : "unknown";
  let warmupTokens = 0;
  let incrementalTokens = 0;
  let rewrittenTokens = 0;

  if (baseCause === "first-call" || baseCause === "model-switch" || baseCause === "compaction") {
    state.epoch += 1;
    warmupTokens = create;
    state.established = footprint;
  } else {
    incrementalTokens = Math.min(create, Math.max(0, footprint - state.established));
    rewrittenTokens = create - incrementalTokens;
    state.established = Math.max(state.established, footprint);
  }

  const promptModelKey = `${current.promptId ?? ""}\u0000${current.model}`;
  const priorWarmup = state.warmupByPromptModel.get(promptModelKey);
  const duplicatedWarmup =
    rewrittenTokens > 0 &&
    current.promptId !== undefined &&
    read === 0 &&
    priorWarmup !== undefined &&
    priorWarmup.epoch < state.epoch &&
    rewrittenTokens >= priorWarmup.tokens;
  if (warmupTokens > 0 && current.promptId !== undefined) {
    state.warmupByPromptModel.set(promptModelKey, { epoch: state.epoch, tokens: warmupTokens });
  }

  return {
    eventId: current.messageId,
    callId: current.messageId,
    promptId: current.promptId ?? null,
    turnNumber: turnNumberByCall.get(current.messageId) ?? null,
    timestamp: current.timestamp,
    model: current.model,
    project: current.cwd,
    branch: current.gitBranch,
    warmupTokens,
    incrementalTokens,
    rewrittenTokens,
    baseCause,
    attribution,
    kind:
      rewrittenTokens > 0
        ? duplicatedWarmup
          ? "duplicated-warmup"
          : eventKind(attribution)
        : null,
  };
}

export function computeScorecard(calls: ApiCall[], turns: Turn[]): CacheScorecardCore {
  const mainCalls = calls.filter((call) => !call.isSidechain);
  const sessionId = mainCalls[0]?.sessionId ?? turns[0]?.sessionId ?? "";
  const streams = partitionCacheStreams(mainCalls);
  const stream = streams.get(`${sessionId}::${MAIN_STREAM_KEY}`) ?? [];
  stabilizeTimestampTies(stream);
  const turnNumberByCall = buildTurnNumberByCall(turns);

  let warmup = 0;
  let incremental = 0;
  let rewritten = 0;
  let cacheReadTokens = 0;
  let inputTokens = 0;
  const state = createDecompositionState();
  const writes: CacheCreationEntry[] = [];

  for (let index = 0; index < stream.length; index += 1) {
    const current = stream[index];
    if (!current) continue;
    cacheReadTokens += current.usage.cacheReadTokens;
    inputTokens += current.usage.inputTokens;

    const entry = classifyCall(stream, index, current, turnNumberByCall, state);
    if (!entry) continue;

    warmup += entry.warmupTokens;
    incremental += entry.incrementalTokens;
    rewritten += entry.rewrittenTokens;
    writes.push(entry);
  }

  const totalCreation = warmup + incremental + rewritten;
  const confirmedFixableWaste = writes.reduce(
    (sum, entry) =>
      entry.kind === "prefix-bust" || entry.kind === "duplicated-warmup"
        ? sum + entry.rewrittenTokens
        : sum,
    0,
  );
  const scoreableCreation = warmup + incremental + confirmedFixableWaste;
  const hitDenominator = inputTokens + cacheReadTokens + totalCreation;

  return {
    sessionId,
    mainThreadCalls: stream.length,
    cacheReadTokens,
    writes,
    decomposition: { warmup, incremental, rewritten },
    wasteRatio: totalCreation > 0 ? rewritten / totalCreation : null,
    hitRatio: hitDenominator > 0 ? cacheReadTokens / hitDenominator : 0,
    scoreInputs: { confirmedFixableWaste, scoreableCreation },
    hygieneScore: scoreableCreation > 0 ? 1 - confirmedFixableWaste / scoreableCreation : null,
  };
}
