import type { GateEvidence, GateResult } from "../../shared/gates-contract.js";
import type { Turn } from "../../shared/types.js";

/**
 * P3 — Code-before-read (gates.md §"P3 — Code-before-read").
 *
 * Practice: "Explore first — edit only what was actually read." For each
 * Edit call, if the target file path has no prior Read tool_use (same
 * session, any earlier call, main thread) and the file existed before
 * the session (i.e., the first touch is `Edit`, not `Write`-that-creates),
 * → fail per file.
 *
 * `@`-mention read (R11 / gates.md §P3): files attached to a user message
 * via `@/path/to/file` appear as a path string in the user prompt. We
 * best-effort substring-match the target path against every prior main-
 * turn's `promptText` (deterministic over what's in the transcript —
 * unmatched = still fail, per the spec).
 *
 * Carve-out: Write without prior Read is creation-style and N/A (gates.md
 * §P3). Both Edits and Writes are normalized the same way for the read
 * check; only Edit without read contributes a fail event.
 */

/** Predicate: is this tool_use block a Read? Centralized so @-mention matching and the call walk agree. */
function isReadToolName(name: string): boolean {
  return name === "Read";
}

/** Predicate: is this tool_use block an Edit (or equivalent)? Edit is the gate's failure trigger. */
function isEditToolName(name: string): boolean {
  return name === "Edit";
}

export function evaluateP3(turns: Turn[]): GateResult {
  const evidence: GateEvidence[] = [];
  // Cumulatively read files — a path enters this set either via a Read
  // tool_use or via an @-mention substring hit in a prior user message.
  const readFiles = new Set<string>();
  // Paths that have already produced a fail evidence entry — one entry per
  // offending file is the documented "fail per file" contract.
  const failedFiles = new Set<string>();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    // Materialize the prior-prompt @-mention index lazily per turn: every
    // turn's prompt text is fixed at this point (deriveTurns captured it
    // at parse time), and we only need to consult it for paths that this
    // gate hasn't seen yet. O(N·M) over turn count × prompt length —
    // negligible at the call counts the project actually tracks.
    const priorPromptTexts = turns.slice(0, i).map((t) => t.promptText ?? "");

    for (const call of turn.calls) {
      for (const tool of call.tools) {
        if (isReadToolName(tool.name)) {
          if (tool.targetPath) readFiles.add(tool.targetPath);
          continue;
        }
        if (!isEditToolName(tool.name)) continue;
        if (!tool.targetPath) continue;
        const path = tool.targetPath;

        if (readFiles.has(path)) continue;

        // @-mention fall-back: does any prior main-chain prompt mention
        // the path? Best-effort substring per the spec — unmatched means
        // we still fail (deterministic over what's in the transcript).
        let mentioned = false;
        for (const promptText of priorPromptTexts) {
          if (promptText.length > 0 && promptText.includes(path)) {
            mentioned = true;
            break;
          }
        }
        if (mentioned) {
          readFiles.add(path);
          continue;
        }

        // First-touch detection for the "fail per file" contract: only
        // emit one evidence entry per offending file. Subsequent Edits on
        // the same path stay silent.
        if (failedFiles.has(path)) continue;
        failedFiles.add(path);
        evidence.push({
          turnN: i + 1,
          callId: call.messageId,
          filePath: path,
          detail: `Edit on ${path} with no prior Read tool_use and no @-mention in prior user message (Write-without-read is N/A and skipped)`,
        });
      }
    }
  }

  const status: GateResult["status"] = evidence.length > 0 ? "fail" : "pass";
  return { gateId: "P3", status, evidence };
}
