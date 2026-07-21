/**
 * Wire shape for the Data Health endpoint (#P4-13 gating #P4-14, #P4-14).
 * Surfaces per-file malformed-line counts accumulated by `parse-premium.ts`
 * (C/B/L parsers) so the Data Health page can render "X malformed lines
 * across Y premium files" with the affected file paths. Without this
 * contract the parsers' malformed-count guarantee is invisible to clients.
 *
 * #P4-14 extends this contract additively with transcript-tier rollups
 * (dedup, parse errors, scan coverage, pricing coverage, sidecar coverage)
 * plus a fleet reconciliation rollup and capture-gap count. The original
 * four fields are unchanged; new fields sit alongside them so existing
 * callers continue to work and the wire shape evolves in one direction.
 *
 * Design notes:
 *   - `malformedCount` is a CUMULATIVE count since server start, not a
 *     per-read snapshot. A full file re-read on every change (no offset /
 *     dedupe in `parse-premium.ts`) means the count would otherwise grow
 *     unboundedly across many reads of the same file; summing the most
 *     recent read's count would lose the "this file had any malformed
 *     line ever" signal. Cumulativeness + bounded per-read growth keeps
 *     the operator-facing signal honest.
 *   - `filePath` is absolute. Clients render the basename to avoid leaking
 *     the user's home directory layout into shared log streams.
 *   - `observedSince` is wall-clock ms at server start. Clients can use
 *     "now - observedSince" to display uptime.
 *   - All #P4-14 fields are required and non-nullable. Missing data is
 *     represented as zero counts / empty arrays, never `undefined`, so
 *     clients can render the page without per-field presence checks.
 *     The `reconciliation.costLogTotal` field is the one exception — it
 *     is `undefined` when the global L capture file is not present
 *     (the L file is one-per-user, not per-session).
 */

import type { ScanRootConfig } from "./settings-contract.js";

export type PremiumFileClass = "cost" | "turn-boundaries" | "cost-log";

export interface PremiumFileHealth {
  /** Absolute file path (clients render the basename). */
  filePath: string;
  /** Premium file class. */
  fileClass: PremiumFileClass;
  /** Session UUID this file applies to, or `undefined` for the global L file. */
  sessionId?: string;
  /** Cumulative malformed-line count since server start. */
  malformedCount: number;
  /** Wall-clock ms when this entry was last touched (monotonic refresh). */
  lastUpdated: number;
}

// --- #P4-14: transcript-tier rollups ---------------------------------------

/** Raw lines vs distinct `ApiCall`s after `message.id` dedupe. */
export interface DedupStats {
  /** Σ raw transcript lines read across all sessions. */
  rawLines: number;
  /** Σ distinct `ApiCall`s accumulated into the store (≈ Σ `state.calls.length`). */
  distinctCalls: number;
  /** Σ collapsed `message.id` duplicates. Always satisfies
   *  `duplicates = rawLines - distinctCalls - skippedLines` modulo
   *  parser-internal skipped records (e.g. tool_result bytes dropped by
   *  parse-transcript.ts that don't produce a duplicate either). */
  duplicates: number;
}

/** Per-file transcript-tier malformed-line counts (top-N by count). */
export interface ParseErrorSummary {
  /** Σ malformed transcript lines across all files. */
  malformedLines: number;
  /** Top-N files by malformed-line count, descending. The store caps
   *  this list (e.g. 20) so a single corrupt file cannot bloat the
   *  response; clients render the full Σ in the page header and the
   *  list as a drill-down table. `filePath` is absolute; clients
   *  render the basename. */
  byFile: { filePath: string; count: number }[];
}

/** Scan roots + per-tier file tallies. */
export interface ScanCoverage {
  /** Active scan roots, from `config.scanRoots`. Empty array if the
   *  user has not configured any (the dashboard then shows a CTA to
   *  open Settings). */
  roots: ScanRootConfig[];
  /** Total distinct `.jsonl` files the poller has discovered since
   *  server start. Includes files that have not yet produced a
   *  single parsed call (e.g. a freshly tailed file that is still
   *  warming up). */
  transcriptsFound: number;
  /** Sessions successfully accumulated into the store — i.e.
   *  `listSessions().length` after a lazy recompute. Files that
   *  exist on disk but never produced a single call (e.g. malformed
   *  end-to-end) sit in `transcriptsFound - transcriptsParsed`. */
  transcriptsParsed: number;
  /** `transcriptsFound - transcriptsParsed` for sessions the poller
   *  has touched ≥ `N=5` times without producing a call. Sessions
   *  that simply haven't been read yet (cold boot, slow tail) are
   *  not counted here. The store recomputes this defensively on
   *  every snapshot. */
  transcriptsFailed: number;
  /** Sessions with at least one of `hasCostSamples` / `hasTurnBoundaries` / `hasCostLog` true. */
  sessionsWithSidecars: number;
}

/** Models seen across the fleet vs the configured pricing table. */
export interface PricingCoverage {
  /** Distinct `ApiCall.model` values across the fleet. Sorted
   *  lexicographically so the page renders a stable table. */
  modelsSeen: string[];
  /** Subset of `modelsSeen` absent from the pricing table. Empty
   *  when every seen model is priced. Sorted lexicographically. */
  unpricedModels: string[];
}

/** Per-sidecar coverage counts derived from `SessionSidecarFlags`. */
export interface SidecarCoverage {
  /** Total sessions in the store (after lazy recompute). */
  total: number;
  /** Sessions with `hasCostSamples`. */
  withCost: number;
  /** Sessions with `hasTurnBoundaries`. */
  withBoundaries: number;
}

/** Fleet-level reconciliation rollup. The per-session signal lives on
 *  `Session.premium` (Σ into these totals). When C is absent and only
 *  L is present, `costObserved` still carries a value (L's per-session
 *  total stands in, per `reconcile-premium.ts` A4). `costLogTotal` is
 *  `undefined` when the global L capture is not present. */
export interface ReconciliationRollup {
  /** Count of sessions with `costBasis === "observed"`. */
  sessionsWithObserved: number;
  /** Total sessions minus the above. */
  sessionsWithComputedOnly: number;
  /** Σ `Session.costComputed` (unpriced models contribute $0 honestly). */
  costComputed: number;
  /** Σ `Session.premium.costObserved` across premium sessions. */
  costObserved: number;
  /** Σ L-file session totals when L is present. */
  costLogTotal: number | undefined;
}

/** Sub-card of the §4 reconciliation section. */
export interface CaptureGaps {
  /** Sessions without observed-data capture (= `reconciliation.sessionsWithComputedOnly`).
   *  Exposed separately for the §4 sub-card so the renderer does not
   *  need to know about the reconciliation rollup's internal alias. */
  sessionsWithoutObserved: number;
}

export interface HealthSnapshot {
  // === #P4-13 (premium tier, already shipped) ===
  /** Per-file rolling health entries. */
  files: PremiumFileHealth[];
  /** Sum of `malformedCount` across `files`. */
  totalMalformedLines: number;
  /** Number of distinct premium files observed since server start. */
  observedFileCount: number;
  /** Wall-clock ms at server start (for "uptime" displays). */
  observedSince: number;

  // === #P4-14 (transcript tier + reconciliation) ===
  /** Raw lines → distinct `ApiCall`s after `message.id` dedupe. */
  dedup: DedupStats;
  /** Per-file transcript-tier malformed-line counts. */
  parseErrors: ParseErrorSummary;
  /** Active scan roots + per-tier file tallies. */
  scan: ScanCoverage;
  /** Models seen across the fleet vs the configured pricing table. */
  pricingCoverage: PricingCoverage;
  /** Per-sidecar coverage counts. */
  sidecarCoverage: SidecarCoverage;
  /** Fleet-level reconciliation rollup (computed vs observed). */
  reconciliation: ReconciliationRollup;
  /** Capture-gap sub-card of §4. */
  captureGaps: CaptureGaps;
}
