import type { GateEvidence, GateResult, GateThresholds } from "../../shared/gates-contract.js";
import type { Turn } from "../../shared/types.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";

/**
 * V2 — Failing-command loop (gates.md §"V2 — Failing-command loop").
 *
 * Practice: "verification should converge, not thrash." Within a main-chain
 * turn, if the same normalized Bash command produces an error result
 * ≥ `v2Repeat` times, the turn fails.
 *
 * Error detection (R10): the parser already resolves both axes —
 * `tool_result.is_error === true` OR a non-zero exit code in the Bash
 * result content (`extractExitCode` in server/ingest/parse-transcript.ts) —
 * into `ToolResultBytesRecord.isError`. V2 reads that flag and never
 * re-detects.
 *
 * Command normalization (ARCH A9): trim + collapse internal whitespace
 * runs to a single space. Keeps the gate deterministic across shell
 * quoting variations like `git status` vs `git  status`.
 *
 * Pre-filter: `preprocess` already excluded sidechain calls; V2 sees only
 * main-chain data. Empty / whitespace-only commands collapse to one key
 * "  " so multiple faceless failed runs still surface.
 */

export function evaluateV2(
  turns: Turn[],
  toolResults: ToolResultBytesRecord[],
  thresholds: Pick<GateThresholds, "v2Repeat">,
): GateResult {
  // Index tool results by toolUseId for O(1) lookup per Bash invocation.
  // Last-wins on duplicate toolUseId keeps the gate total — the parser
  // never produces duplicates today, but a malformed transcript shouldn't
  // throw inside a deterministic check.
  const isErrorByToolUseId = new Map<string, boolean>();
  for (const record of toolResults) {
    isErrorByToolUseId.set(record.toolUseId, record.isError);
  }

  const evidence: GateEvidence[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    // Per-command failure tally: normalized command → { count, callIds[] }.
    // Only Bash tool_use blocks are tallied — other tools aren't commands.
    const failuresByCommand = new Map<string, { count: number; callIds: string[] }>();

    for (const call of turn.calls) {
      for (const tool of call.tools) {
        if (tool.name !== "Bash") continue;
        // toolUseId is required to link to the tool_result record. Without
        // it, the Bash invocation's success/failure is unknowable from the
        // store; skip rather than synthesize a verdict.
        if (typeof tool.id !== "string" || tool.id.length === 0) continue;
        if (isErrorByToolUseId.get(tool.id) !== true) continue;

        // Without the command text we can't tell "same command" apart from
        // "two distinct commands". A Bash tool_use that omits the command
        // string is unusual (parser only sets `bashCommand` when
        // `input.command` was present); using `tool.id` as the fallback
        // key degenerates to "this invocation failed repeatedly", which
        // is strictly stricter than the spec — acceptable for a defensive
        // fallback that signals missing data rather than silently allowing
        // a pass.
        const commandText = tool.bashCommand ?? tool.id;
        const normalized = normalizeBashCommand(commandText);
        const slot = failuresByCommand.get(normalized) ?? { count: 0, callIds: [] };
        slot.count += 1;
        slot.callIds.push(call.messageId);
        failuresByCommand.set(normalized, slot);
      }
    }

    // One evidence entry per (turn, repeated command) — gives the UI a
    // separate row per repeated command in its drill-down.
    for (const [command, slot] of failuresByCommand) {
      if (slot.count < thresholds.v2Repeat) continue;
      const lastFailingCallId = slot.callIds[slot.callIds.length - 1];
      evidence.push({
        turnN: i + 1,
        callId: lastFailingCallId,
        detail: `command "${redactSecrets(command)}" failed ${slot.count} times in turn ${i + 1}; failing call ids: ${slot.callIds.join(", ")}`,
      });
    }
  }

  const status: GateResult["status"] = evidence.length > 0 ? "fail" : "pass";
  return { gateId: "V2", status, evidence };
}

/**
 * Per gates.md §V2 + ARCH A9: trim leading/trailing whitespace, collapse
 * internal whitespace runs to a single space. The empty/whitespace-only
 * edge case collapses to a single empty-string key — multiple faceless
 * failed runs would still surface, which matches the gate's intent.
 */
function normalizeBashCommand(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// Recognizable credential shapes to mask before a command string is
// surfaced in `GateEvidence.detail` (returned unauthenticated over
// `GET /api/sessions/:id/gates`). Grouping/dedup above runs on the
// unredacted `normalizeBashCommand` output, so this never affects which
// commands count as "the same repeated command" — it only narrows what
// leaves the server in the evidence text (review finding: `bashCommand`
// retention exposes secrets baked into a failing command, e.g. a Bearer
// token on a curl invocation).
const SECRET_PATTERNS: RegExp[] = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(sk|pk|ghp|gho|ghu|ghs|ghr|AKIA)[A-Za-z0-9_-]{10,}/g,
  /(--?(?:password|token|api[-_]?key|secret)[= ])(\S+)/gi,
];

function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, prefix?: string) =>
      prefix ? `${prefix}***REDACTED***` : "***REDACTED***",
    );
  }
  return redacted;
}
