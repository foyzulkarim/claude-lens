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

export function computeScorecard(calls: ApiCall[], turns: Turn[]): CacheScorecardCore {
  const mainCalls = calls.filter((call) => !call.isSidechain);
  const sessionId = mainCalls[0]?.sessionId ?? turns[0]?.sessionId ?? "";
  const streams = partitionCacheStreams(mainCalls);
  const stream = streams.get(`${sessionId}::${MAIN_STREAM_KEY}`) ?? [];
  stabilizeTimestampTies(stream);
  const turnNumberByCall = buildTurnNumberByCall(turns);

  let established = 0;
  let warmup = 0;
  let incremental = 0;
  let rewritten = 0;
  let cacheReadTokens = 0;
  let inputTokens = 0;
  let epoch = 0;
  const warmupByPromptModel = new Map<string, { epoch: number; tokens: number }>();
  const writes: CacheCreationEntry[] = [];

  for (let index = 0; index < stream.length; index += 1) {
    const current = stream[index];
    if (!current) continue;
    const previous = stream[index - 1];
    const create = current.usage.cacheCreateTokens;
    const read = current.usage.cacheReadTokens;
    const footprint = read + create;
    cacheReadTokens += read;
    inputTokens += current.usage.inputTokens;

    if (create <= 0) {
      if (previous && current.model !== previous.model) {
        epoch += 1;
        established = footprint;
      } else established = Math.max(established, footprint);
      continue;
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
      epoch += 1;
      warmupTokens = create;
      established = footprint;
    } else {
      incrementalTokens = Math.min(create, Math.max(0, footprint - established));
      rewrittenTokens = create - incrementalTokens;
      established = Math.max(established, footprint);
    }

    warmup += warmupTokens;
    incremental += incrementalTokens;
    rewritten += rewrittenTokens;
    const promptModelKey = `${current.promptId ?? ""}\u0000${current.model}`;
    const priorWarmup = warmupByPromptModel.get(promptModelKey);
    const duplicatedWarmup =
      rewrittenTokens > 0 &&
      current.promptId !== undefined &&
      read === 0 &&
      priorWarmup !== undefined &&
      priorWarmup.epoch < epoch &&
      rewrittenTokens >= priorWarmup.tokens;
    if (warmupTokens > 0 && current.promptId !== undefined) {
      warmupByPromptModel.set(promptModelKey, { epoch, tokens: warmupTokens });
    }
    writes.push({
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
    });
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
