import type { GateId, GateThresholds } from "../../../shared/gates-contract.js";

export interface GateGlossaryEntry {
  /** Short human-readable label shown inline next to the bare gate code. */
  label: string;
  /** One sentence: what the gate looks for. */
  whatItChecks: string;
  /** One sentence: why a failure here is worth caring about. */
  whyItMatters: string;
}

/**
 * UI paraphrase of `specs/gates.md`'s per-gate sections — short "what it
 * checks" / "why it matters" text, not the full rule prose (that stays in
 * gates.md and in the Turn Inspector evidence). Keep in sync with gates.md
 * if a gate's rule changes.
 */
export const GATE_GLOSSARY: Record<GateId, GateGlossaryEntry> = {
  V1: {
    label: "Edit-without-verify",
    whatItChecks:
      "Flags a turn where Claude edited a file but never ran a command afterward to check the result.",
    whyItMatters:
      "Without a runnable check after edits, you become the verification loop — every mistake waits for a human to notice.",
  },
  V2: {
    label: "Failing-command loop",
    whatItChecks:
      "Flags the same command failing repeatedly within one turn instead of converging.",
    whyItMatters:
      "Repeated identical failures mean Claude is guessing; each guess re-bills a growing context. The fix is a human interrupt with the real error or constraint.",
  },
  P3: {
    label: "Code-before-read",
    whatItChecks:
      "Flags an edit to a pre-existing file that was never read earlier in the session.",
    whyItMatters:
      'Edits to unread files come from training-data patterning rather than the actual code — the classic "invented an API" failure.',
  },
  C3: {
    label: "Fat tool result",
    whatItChecks: "Flags a single tool result (e.g. a Read) that came back unusually large.",
    whyItMatters:
      "An oversized read is paid once as a write and then again on every later call as a cache read — one big read becomes a recurring cost.",
  },
  K2: {
    label: "Unexplained cache invalidation",
    whatItChecks:
      "Flags a large cache-creation spike that isn't explained by the first call of the session, a model switch, or a compaction event.",
    whyItMatters:
      "Unexplained spikes almost always mean something changed mid-session (CLAUDE.md, MCP config, settings) and broke the cache prefix.",
  },
  E1: {
    label: "CLAUDE.md missing",
    whatItChecks:
      "Checks whether a CLAUDE.md exists at the project root or in ~/.claude at analysis time.",
    whyItMatters:
      "Without a CLAUDE.md, your conventions get re-explained — and re-billed — every session.",
  },
  E2: {
    label: "CLAUDE.md bloated",
    whatItChecks: "Checks whether an existing CLAUDE.md is over the configured size or line limit.",
    whyItMatters:
      'A bloated CLAUDE.md causes instruction loss — experienced as "Claude ignores my instructions."',
  },
};

/**
 * The one dynamic sentence per gate that has a configurable constant
 * (`specs/gates.md` §"Configurable constants"). V1, P3, and E1 are
 * threshold-free and return `null`. Reads the session's actual
 * `thresholdsUsed` rather than a hardcoded default, so a custom Settings
 * value shows up here too.
 */
export function describeThreshold(gateId: GateId, thresholds: GateThresholds): string | null {
  switch (gateId) {
    case "V2":
      return `Currently: fails when the same command errors ${thresholds.v2Repeat}+ times in one turn.`;
    case "C3":
      return `Currently: warns when a single tool result exceeds ${thresholds.c3MaxChars.toLocaleString()} characters.`;
    case "K2":
      return `Currently: checks cache-creation spikes over ${thresholds.k2Spike.toLocaleString()} tokens.`;
    case "E2":
      return `Currently: warns above ${thresholds.e2MaxChars.toLocaleString()} characters or ${thresholds.e2MaxLines} lines.`;
    case "V1":
    case "P3":
    case "E1":
      return null;
  }
}

/** Overall Report Card score, per `specs/gates.md` §"Report Card scoring". */
export const SCORE_EXPLANATION =
  "Score = passes / (passes + 0.5 × warns + fails), across six checks (E1 and E2 share one " +
  "check). A warn counts as half a fail. Turns or files the gate doesn't apply to are excluded, " +
  "not counted as passes.\n\n" +
  "Letter grade: A ≥ 90%, B ≥ 75%, C ≥ 50%, D ≥ 25%, otherwise F.";
