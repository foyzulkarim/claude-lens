/**
 * Wire shape for the Data Health endpoint (#P4-13 gating #P4-14, #P4-14).
 * Surfaces per-file malformed-line counts accumulated by `parse-premium.ts`
 * (C/B/L parsers) so the Data Health page can render "X malformed lines
 * across Y premium files" with the affected file paths. Without this
 * contract the parsers' malformed-count guarantee is invisible to clients.
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
 */

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

export interface HealthSnapshot {
  /** Per-file rolling health entries. */
  files: PremiumFileHealth[];
  /** Sum of `malformedCount` across `files`. */
  totalMalformedLines: number;
  /** Number of distinct premium files observed since server start. */
  observedFileCount: number;
  /** Wall-clock ms at server start (for "uptime" displays). */
  observedSince: number;
}
