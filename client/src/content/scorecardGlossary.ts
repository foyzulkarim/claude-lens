import type { ScorecardBands, WasteEventKind } from "../../../shared/scorecard-contract.js";

/**
 * Short label for each `WasteEventKind` chip. Was `Scorecard.tsx`'s private
 * `KIND_LABEL` — moved here and paired with `WASTE_EVENT_KIND_GLOSSARY` so
 * the label and its explanation can't drift apart.
 */
export const KIND_LABEL: Record<WasteEventKind, string> = {
  "prefix-bust": "prefix bust",
  "duplicated-warmup": "duplicated warmup",
  "idle-expiry": "idle expiry",
  unattributed: "unexplained",
};

/**
 * UI paraphrase of `specs/gates.md` §"Cache Scorecard scoring". Only
 * `prefix-bust` and `duplicated-warmup` are confirmed-fixable and count
 * against the hygiene score; the other two are visible/priceable but
 * grade-neutral.
 */
export const WASTE_EVENT_KIND_GLOSSARY: Record<WasteEventKind, string> = {
  "prefix-bust":
    "Something earlier in the conversation prefix changed (CLAUDE.md, MCP config, tool list) so the cache no longer matched and had to be rebuilt. Counts against the hygiene score.",
  "duplicated-warmup":
    "The same prompt was warmed up from scratch again in a later epoch with zero cache read — a repeat of work already paid for once. Counts against the hygiene score.",
  "idle-expiry":
    "The cache entry's TTL simply lapsed from sitting idle too long. Visible and priceable, but grade-neutral — not a hygiene issue.",
  unattributed:
    "No specific cause could be classified for this rewrite. Visible and priceable, but grade-neutral.",
};

export const METRIC_GLOSSARY = {
  warmup:
    "The first cache write in a fresh epoch (session start, a model switch, or right after compaction) — a necessary cost, never counted as waste.",
  incremental:
    "New content added on top of what was already cached — normal, expected growth as a conversation continues.",
  rewritten:
    "Cache content that had to be recreated even though it should still have been valid — this is the waste signal the hygiene score is built from.",
  wasteRatio: "Share of scoreable cache-creation tokens that were rewritten instead of reused.",
  hitRatio: "Share of tokens served from cache instead of being freshly billed.",
} as const;

/** Hygiene score formula, per `specs/gates.md` §"Hygiene score and evidence". */
export const HYGIENE_SCORE_EXPLANATION =
  "Hygiene score = 1 − confirmedFixableWaste / scoreableCreation, where scoreableCreation = " +
  "warmup + incremental + confirmedFixableWaste. Only prefix-bust and duplicated-warmup waste " +
  "counts against the score — idle-expiry and unexplained rewrites are visible but grade-neutral.";

/**
 * Dynamic sentence for this session's actual applied grade cutoffs —
 * reads `SessionScorecardView`'s resolved `bands` (which already reflects
 * fleet calibration) rather than the raw configured thresholds, since
 * `bands` is what the grade was actually computed against.
 */
export function describeGradeBands(bands: ScorecardBands): string {
  const sourceNote =
    bands.source === "calibrated"
      ? "these cutoffs are calibrated against your fleet's actual sessions (calibration can only improve a grade by one letter, never lower it)."
      : "these are the fixed default cutoffs — fleet calibration hasn't kicked in yet (needs enough gradeable sessions).";
  return `This session's grade: A ≥ ${bands.A}%, B ≥ ${bands.B}%, C ≥ ${bands.C}%, D ≥ ${bands.D}%, otherwise F — ${sourceNote}`;
}
