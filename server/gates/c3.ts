import type { GateEvidence, GateResult, GateThresholds } from "../../shared/gates-contract.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import type { PreprocessedSession } from "./preprocess.js";

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

/** Approximate tokens per character — Anthropic's rule-of-thumb for English text. */
const CHARS_PER_TOKEN = 4;

export function evaluateC3(
  pre: PreprocessedSession,
  allToolResults: ToolResultBytesRecord[],
  thresholds: Pick<GateThresholds, "c3MaxChars">,
): GateResult {
  // Index originating calls by toolUseId — needed to attach evidence to
  // the call that produced each fat tool_result, and to locate its turn.
  // Main-chain calls only — sidechain tool_results are filtered out
  // below, so a sidechain toolUseId never appears as a lookup key.
  const callByToolUseId = new Map<string, (typeof pre.mainCalls)[number]>();
  for (const call of pre.mainCalls) {
    for (const tool of call.tools) {
      if (typeof tool.id === "string" && tool.id.length > 0) {
        callByToolUseId.set(tool.id, call);
      }
    }
  }

  // Sort every call in the session (main + sidechain, ARCH A7) by
  // timestamp once so the per-record "remaining calls" denominator is a
  // cheap binary search / linear sweep, not an O(N) scan per fat result.
  // Stable secondary key on messageId so identical-timestamp calls aren't
  // sensitive to iteration order.
  const allCalls = [...pre.mainCalls, ...pre.sidechainCalls];
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
    indexByMessageId.set(sortedAllCalls[i]?.messageId ?? "", i);
  }

  const evidence: GateEvidence[] = [];

  for (const record of allToolResults) {
    // Sidechain tool_results are out of scope (gates.md §Shared
    // preprocessing) — skip upfront so the rest of the loop body is
    // main-chain-only and reads in the order documented by the spec
    // (review nice-to-have "reorder sidechain skip to upfront"). The
    // recurring-cost math on main-chain fat results still counts
    // sidechain calls in the denominator via sortedAllCalls above.
    if (record.isSidechain === true) continue;
    if (record.bytes <= thresholds.c3MaxChars) continue;
    const originatingCall = callByToolUseId.get(record.toolUseId);
    if (!originatingCall) continue;

    const tool = originatingCall.tools.find((t) => t.id === record.toolUseId);
    const toolName = tool?.name ?? "unknown";

    const callIndex = indexByMessageId.get(originatingCall.messageId);
    // Defensive: every call indexed above for toolUseId is in
    // sortedAllCalls because both iterate the same input array.
    if (callIndex === undefined) continue;
    const remainingCalls = remainingCallsFromIndex[callIndex] ?? 0;
    const tokens = record.bytes / CHARS_PER_TOKEN;
    const recurringTokenEquivalent = tokens * remainingCalls;

    evidence.push({
      turnN: pre.mainTurnNByMessageId.get(originatingCall.messageId),
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
