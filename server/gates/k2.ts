import type { GateEvidence, GateResult, GateThresholds } from "../../shared/gates-contract.js";
import type { ClassifierTrace } from "../../shared/cache-lab-contract.js";
import type { ApiCall, Turn } from "../../shared/types.js";
import { classifyCacheWrite } from "../cache/classifier.js";

/**
 * K2 — Unexplained cache invalidation (gates.md §"K2 — Unexplained cache
 * invalidation").
 *
 * Practice: cost discipline — the prefix should be stable. For each call
 * with `cache_creation_input_tokens > k2Spike`, run the cause classifier
 * (issue R5 / shared with Cache Lab, server/cache/classifier.ts:
 * `classifyCacheWrite`) and:
 *
 *   1. first call of session → explained (no event)
 *   2. `model` differs from previous call → explained (model switch)
 *   3. previous call's `cache_read` is more than 50% lower than the call
 *      immediately before it → explained (compaction)
 *   4. otherwise → fail (unexplained)
 *
 * Evidence (R13) embeds the full `ClassifierTrace` so the UI can surface
 * which branch fired and what values were observed. The TTL attribution
 * overlay (`attributeCacheMiss`) is intentionally NOT imported here —
 * Cache Lab surfaces that verdict chip on its own page; mixing it into
 * K2 would double-attribute (ARCH A2).
 *
 * Pre-filter: sidechain calls are excluded from K2's stream (gates.md
 * §Shared preprocessing). The classifier's per-stream walk still works
 * without sidechain input.
 */

export function evaluateK2(
  turns: Turn[],
  calls: ApiCall[],
  thresholds: Pick<GateThresholds, "k2Spike">,
): GateResult {
  // Build the main-chain stream: chronological order is what
  // `classifyCacheWrite` expects (its `partitionCacheStreams` normalizes
  // the same way). Sidechain calls are absent — preprocess dropped them.
  const stream = [...calls].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Map messageId → 1-indexed main turn number for the evidence's turnN
  // field. Same map as C3's, rebuilt here per-gate to keep each gate's
  // data flow self-contained.
  const turnNByMessageId = new Map<string, number>();
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    for (const call of turn.calls) {
      turnNByMessageId.set(call.messageId, i + 1);
    }
  }

  const evidence: GateEvidence[] = [];

  for (let i = 0; i < stream.length; i++) {
    const call = stream[i];
    if (call.usage.cacheCreateTokens <= thresholds.k2Spike) continue;
    const classification = classifyCacheWrite(stream, i, { threshold: thresholds.k2Spike });
    // Classifier returns null when the strict-`>` threshold isn't met
    // (defensive — the `<=` check above is the primary gate). A null
    // result means we don't have an unexplained spike; skip silently.
    if (!classification) continue;
    if (classification.baseCause !== "unexplained") continue;

    evidence.push({
      turnN: turnNByMessageId.get(call.messageId),
      callId: call.messageId,
      detail: formatK2Trace(classification.trace, call),
    });
  }

  const status: GateResult["status"] = evidence.length > 0 ? "fail" : "pass";
  return { gateId: "K2", status, evidence };
}

/**
 * Render the full classifier trace as a single human-readable string.
 * Always includes the base-cause verdict ("unexplained") so the UI
 * doesn't have to remember the gate's contract. Trace fields are
 * surfaced verbatim (the spec requires "which checks ran and their
 * values"), not summarized, so a reader can audit the classifier's
 * decision without re-running it.
 */
function formatK2Trace(trace: ClassifierTrace, call: ApiCall): string {
  const compactionRatio =
    trace.compactionRatio === null ? "(n/a)" : trace.compactionRatio.toFixed(2);
  const parts: string[] = [
    `cacheCreateTokens=${call.usage.cacheCreateTokens}`,
    `isFirstCall=${trace.isFirstCall}`,
    `model=${call.model}, previousModel=${trace.previousModel ?? "(none)"}, modelSwitched=${trace.modelSwitched}`,
    `previousCacheRead=${trace.previousCacheReadTokens ?? "(n/a)"}, beforePreviousCacheRead=${trace.beforePreviousCacheReadTokens ?? "(n/a)"}, compactionRatio=${compactionRatio}, compactionDetected=${trace.compactionDetected}`,
    `ttlGapMs=${trace.ttlGapMs ?? "(n/a)"}, represented5m=${trace.represented5m}, represented1h=${trace.represented1h}`,
    `baseCause=${trace.isFirstCall ? "first-call" : trace.modelSwitched ? "model-switch" : trace.compactionDetected ? "compaction" : "unexplained"}`,
  ];
  return parts.join("; ");
}
