import type { GateEvidence, GateResult } from "../../shared/gates-contract.js";
import type { ApiCall, ToolUseRef, Turn } from "../../shared/types.js";

/**
 * V1 — Edit-without-verify (gates.md §"V1 — Edit-without-verify").
 *
 * Practice: "Give Claude a way to verify its work." Within a main-chain
 * turn, if any edit call exists and no command call occurs *after the
 * last edit call* (by call order), the turn fails. Session status rolls
 * up: any failing non-final turn → fail; only the final turn failing →
 * warn (the softer final-turn framing, issue acceptance R9); all turns
 * pass → pass. Turns with zero edits are N/A and excluded from the
 * score denominator (gates.md §V1).
 *
 * "Edit call" = a tool_use block with name `Edit` or `Write`. "Command
 * call" = a tool_use block with name `Bash`. Both are detected off the
 * flat ordered list of tool_use blocks within the turn (calls grouped by
 * `promptId`, then tools within each call in source order).
 */

/** Flat tool_use view of one turn, in source order across calls. */
interface FlatTool {
  tool: ToolUseRef;
  call: ApiCall;
  isEdit: boolean;
  isCommand: boolean;
}

function flattenTurnTools(turn: Turn): FlatTool[] {
  const flat: FlatTool[] = [];
  for (const call of turn.calls) {
    for (const tool of call.tools) {
      flat.push({
        tool,
        call,
        isEdit: tool.name === "Edit" || tool.name === "Write",
        isCommand: tool.name === "Bash",
      });
    }
  }
  return flat;
}

export function evaluateV1(turns: Turn[]): GateResult {
  const evidence: GateEvidence[] = [];
  let failingNonFinalTurn = false;
  let failingFinalTurn = false;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const isFinal = i === turns.length - 1;
    const flat = flattenTurnTools(turn);

    // Find the last edit (Edit/Write) by tool order within the turn.
    let lastEditIndex = -1;
    for (let k = flat.length - 1; k >= 0; k--) {
      if (flat[k]?.isEdit) {
        lastEditIndex = k;
        break;
      }
    }
    if (lastEditIndex === -1) {
      // No edits → N/A. Excluded from the score denominator per gates.md §V1.
      continue;
    }

    // Any Bash after the last edit?
    let hasCommandAfter = false;
    for (let k = lastEditIndex + 1; k < flat.length; k++) {
      if (flat[k]?.isCommand) {
        hasCommandAfter = true;
        break;
      }
    }
    if (hasCommandAfter) continue;

    const lastEdit = flat[lastEditIndex];
    if (!lastEdit) {
      // Defensive: the index came from a successful find, but TS doesn't
      // see that — a future refactor that broke the invariant would throw
      // loudly here rather than emit a malformed evidence record.
      throw new Error(`unreachable: flat[${lastEditIndex}] missing after lastEdit find`);
    }
    const lastEditPath = lastEdit.tool.targetPath ?? "";
    // List every edit in the turn for the detail string — "edited file
    // path(s)" per gates.md. Comma-joined; the wire type carries one path
    // in `filePath` (the last edit's), the full list lands in `detail`.
    const editedPaths = flat
      .filter((f) => f.isEdit)
      .map((f) => f.tool.targetPath ?? f.tool.name)
      .join(", ");
    evidence.push({
      turnN: i + 1,
      callId: lastEdit.call.messageId,
      filePath: lastEditPath || undefined,
      detail: `last edit was ${lastEdit.tool.name}(${lastEditPath || "?"}); edits in turn: ${editedPaths}; no command followed`,
    });
    if (isFinal) failingFinalTurn = true;
    else failingNonFinalTurn = true;
  }

  let status: GateResult["status"];
  if (failingNonFinalTurn) status = "fail";
  else if (failingFinalTurn) status = "warn";
  else status = "pass";

  return { gateId: "V1", status, evidence };
}
