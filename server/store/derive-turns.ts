import type { ApiCall, Turn } from "../../shared/types.js";
import type { PromptTextRecord, ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import { addUsage, emptyUsage } from "./token-usage.js";

// Turn grouping key per architecture §4/§5.5. `ApiCall` never carries a
// `promptId` itself (confirmed against real capture data — the field only
// appears on `user` lines), so grouping works by chronological assignment:
// each call belongs to the latest prompt in the same session whose timestamp
// is <= the call's timestamp. A call with no eligible prompt (e.g. tailing
// picks up an assistant line before its prompt line has been read) is
// excluded from turn derivation — it is still present in the store's raw
// call list, just not yet attributable to a turn.
//
// Sidechain attribution: sidechain calls (`isSidechain: true`, spawned via
// the Agent tool) fall chronologically inside their parent prompt's window,
// but represent a sub-agent's own work rather than the main thread's. They
// are split into a separate Turn that shares the same `promptId` but has
// `isSidechain: true`, so sub-agent token usage never gets silently folded
// into the parent turn's rollup. All sidechain calls under one prompt are
// grouped into a single sidechain turn (not split further by `agentId`) —
// a deliberate simplification; multi-sub-agent-per-turn breakdown is not a
// #P2-6 requirement.

interface TurnAccumulator {
  promptId: string;
  isSidechain: boolean;
  promptText?: string;
  promptSource?: string;
  calls: ApiCall[];
}

/**
 * Finds, for each call, the latest prompt (by timestamp) in the same session
 * that started at or before the call. Both inputs are expected to already be
 * scoped to one session (the store calls this per-session); timestamps sort
 * correctly as ISO-8601 strings.
 */
function assignPromptIds(calls: ApiCall[], prompts: PromptTextRecord[]): Map<ApiCall, string> {
  const sortedPrompts = [...prompts].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const sortedCalls = [...calls].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const assignment = new Map<ApiCall, string>();
  let promptIndex = -1;
  for (const call of sortedCalls) {
    while (
      promptIndex + 1 < sortedPrompts.length &&
      (sortedPrompts[promptIndex + 1]?.timestamp ?? "") <= call.timestamp
    ) {
      promptIndex++;
    }
    const prompt = sortedPrompts[promptIndex];
    if (prompt) {
      assignment.set(call, prompt.promptId);
    }
  }
  return assignment;
}

function buildTurn(acc: TurnAccumulator, toolResultBytesByPromptId: Map<string, number>): Turn {
  // acc.calls is never empty: an accumulator is only created in the same
  // iteration as its first `calls.push(call)` (see the loop in deriveTurns),
  // and nothing ever removes from it afterward. Indexing directly here (not
  // `?.` + `?? ""`) means a future refactor that broke that invariant would
  // throw immediately instead of silently writing an empty sessionId.
  const firstCall = acc.calls[0];
  if (!firstCall) throw new Error(`unreachable: turn accumulator for ${acc.promptId} has no calls`);

  const usage = emptyUsage();
  let startedAt = "";
  let endedAt = "";
  for (const call of acc.calls) {
    addUsage(usage, call.usage);
    if (startedAt === "" || call.timestamp < startedAt) startedAt = call.timestamp;
    if (endedAt === "" || call.timestamp > endedAt) endedAt = call.timestamp;
  }

  return {
    promptId: acc.promptId,
    sessionId: firstCall.sessionId,
    isSidechain: acc.isSidechain,
    promptText: acc.promptText,
    promptSource: acc.promptSource,
    startedAt,
    endedAt,
    calls: acc.calls,
    usage,
    toolResultBytes: acc.isSidechain ? 0 : (toolResultBytesByPromptId.get(acc.promptId) ?? 0),
  };
}

export function deriveTurns(
  calls: ApiCall[],
  prompts: PromptTextRecord[],
  toolResultBytes: ToolResultBytesRecord[],
): Turn[] {
  const promptIdByCall = assignPromptIds(calls, prompts);
  const promptTextById = new Map(prompts.map((p) => [p.promptId, p.text]));
  const toolResultBytesByPromptId = new Map<string, number>();
  for (const record of toolResultBytes) {
    toolResultBytesByPromptId.set(
      record.promptId,
      (toolResultBytesByPromptId.get(record.promptId) ?? 0) + record.bytes,
    );
  }

  const accumulators = new Map<string, TurnAccumulator>();
  const order: string[] = [];

  for (const call of calls) {
    const promptId = promptIdByCall.get(call);
    if (!promptId) continue;

    const key = `${promptId}::${call.isSidechain ? "side" : "main"}`;
    let acc = accumulators.get(key);
    if (!acc) {
      const promptText = call.isSidechain ? undefined : promptTextById.get(promptId);
      acc = {
        promptId,
        isSidechain: call.isSidechain,
        promptText,
        promptSource: promptText !== undefined ? "typed" : undefined,
        calls: [],
      };
      accumulators.set(key, acc);
      order.push(key);
    }
    acc.calls.push(call);
  }

  return order.map((key) => {
    const acc = accumulators.get(key);
    if (!acc) throw new Error(`unreachable: missing turn accumulator for key ${key}`);
    return buildTurn(acc, toolResultBytesByPromptId);
  });
}
