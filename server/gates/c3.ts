import type { GateEvidence, GateResult, GateThresholds } from "../../shared/gates-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";

/**
 * C3 — Fat tool result (gates.md §"C3 — Fat tool result").
 *
 * Practice: context is the scarce resource; giant reads recur as
 * cache-read cost on every subsequent call. Any single `tool_result`
 * content length > `c3MaxChars` → warn (not fail — sometimes unavoidable).
 *
 * Evidence (R12): the call, the tool name, result size, AND the
 * recurring-cost estimate `size/4 tokens × remaining API calls in
 * session`. The "remaining calls" interpretation (ARCH A7) is *all*
 * subsequent calls in the session — main AND sidechain — because every
 * later call, regardless of stream, pays the cache-read cost once.
 *
 * Pre-filter: sidechain tool_results are excluded from the gate's check
 * scope (gates.md §Shared preprocessing), but they DO count toward the
 * "remaining calls" denominator since they too re-read the cached prefix.
 */

export function evaluateC3(
  turns: Turn[],
  calls: ApiCall[],
  allCalls: ApiCall[],
  mainToolResults: ToolResultBytesRecord[],
  allToolResults: ToolResultBytesRecord[],
  thresholds: Pick<GateThresholds, "c3MaxChars">,
): GateResult {
  void calls; // main-only calls input reserved for future gate variants
  void mainToolResults; // the gate itself only consumes main-chain results

  // Index originating calls by toolUseId — needed to attach evidence to
  // the call that produced each fat tool_result, and to locate its turn.
  const callByToolUseId = new Map<string, ApiCall>();
  for (const call of calls) {
    for (const tool of call.tools) {
      if (typeof tool.id === "string" && tool.id.length > 0) {
        callByToolUseId.set(tool.id, call);
      }
    }
  }

  // Build call messageId → 1-indexed main turn number for the evidence's
  // turnN field. Sidechain turns are skipped (gates.md §Shared
  // preprocessing); tool_results from sidechain calls are NOT in the
  // gate's check scope, so their evidence stays empty here.
  const turnNByMessageId = new Map<string, number>();
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    for (const call of turn.calls) {
      turnNByMessageId.set(call.messageId, i + 1);
    }
  }

  // Sort every call in the session (main + sidechain, ARCH A7) by
  // timestamp once so the per-record "remaining calls" denominator is a
  // cheap binary search / linear sweep, not an O(N) scan per fat result.
  // Stable secondary key on messageId so identical-timestamp calls aren't
  // sensitive to iteration order.
  const sortedAllCalls = [...allCalls].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
    return a.messageId.localeCompare(b.messageId);
  });

  // Precompute per-call-index the count of "calls strictly after me".
  // This is the remaining-call denominator for any tool_result whose
  // originating call is at this index; computed once for O(1) lookup.
  const remainingCallsFromIndex: number[] = new Array(sortedAllCalls.length + 1).fill(0);
  for (let i = 0; i < sortedAllCalls.length; i++) {
    remainingCallsFromIndex[i] = sortedAllCalls.length - 1 - i;
  }
  // Index of each messageId in the sorted list, for fast lookup.
  const indexByMessageId = new Map<string, number>();
  for (let i = 0; i < sortedAllCalls.length; i++) {
    indexByMessageId.set(sortedAllCalls[i].messageId, i);
  }

  const evidence: GateEvidence[] = [];

  for (const record of allToolResults) {
    if (record.bytes <= thresholds.c3MaxChars) continue;
    const originatingCall = callByToolUseId.get(record.toolUseId);
    if (!originatingCall) continue;
    // Sidechain tool_results are out of scope (gates.md §Shared
    // preprocessing) — they don't generate evidence. The gate still
    // notes their existence by skipping here; the recurring-cost math
    // on main-chain fat results already counts them in the denominator
    // (sortedAllCalls above includes both streams).
    if (record.isSidechain === true) continue;

    const tool = originatingCall.tools.find((t) => t.id === record.toolUseId);
    const toolName = tool?.name ?? "unknown";

    const callIndex = indexByMessageId.get(originatingCall.messageId);
    // Defensive: every call indexed above for toolUseId is in
    // sortedAllCalls because both iterate the same input array.
    if (callIndex === undefined) continue;
    const remainingCalls = remainingCallsFromIndex[callIndex];
    const tokens = record.bytes / 4;
    const recurringTokenEquivalent = tokens * remainingCalls;

    const turnN = turnNByMessageId.get(originatingCall.messageId);
    evidence.push({
      turnN,
      callId: originatingCall.messageId,
      detail:
        `tool "${toolName}" returned ${record.bytes} chars; ` +
        `recurring cost ≈ ${tokens} tokens × ${remainingCalls} remaining calls ` +
        `= ${recurringTokenEquivalent} token-equivalents ` +
        `(threshold ${thresholds.c3MaxChars})`,
    });
  }

  const status: GateResult["status"] = evidence.length > 0 ? "warn" : "pass";
  return { gateId: "C3", status, evidence };
}
