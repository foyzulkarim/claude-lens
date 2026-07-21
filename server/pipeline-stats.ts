// Pipeline-level counters surfaced on the Data Health page (#P4-14).
// Lives in its own file so `server/store/store.ts` can import the type
// without pulling in the pipeline module (which depends on the store — a
// circular import would otherwise break). The pipeline owns the runtime
// counters; this file is purely the type contract.

/**
 * Lightweight pipeline-level counters, read-only. The pipeline mutates
 * these internally; the Store reads them via a callback to keep its
 * snapshot cheap (no direct dependency on the pipeline class).
 */
export interface PipelineStats {
  /** Distinct `.jsonl` files the poller has discovered since server
   *  start. Includes files that have not yet produced a single parsed
   *  call (e.g. a freshly tailed file that is still warming up). */
  transcriptsFound: number;
  /** Sessions whose transcript has been polled ≥ `TRANSCRIPT_FAILED_POLL_THRESHOLD`
   *  times with `state.calls.length === 0`. The pipeline recomputes
   *  this defensively each time the store's snapshot is requested. */
  transcriptsFailed: number;
}

/**
 * Threshold above which a session with zero accumulated calls is
 * considered a failed transcript rather than a not-yet-read one. The
 * poller's slow-re-glob interval is ~5s, so 5 polls ≈ 25s of "no
 * calls" — long enough to ignore cold-boot and short polling hiccups,
 * short enough to flag a genuinely broken transcript. Same value used
 * by the test fixture so the threshold has a single source of truth.
 */
export const TRANSCRIPT_FAILED_POLL_THRESHOLD = 5;
