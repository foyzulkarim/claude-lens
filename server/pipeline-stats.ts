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
  /** Registered transcripts with no parsed calls (`transcriptsFound -
   *  transcriptsParsed`, floored at 0). The store threads its already-
   *  computed `transcriptsParsed` count through the callback so this
   *  doesn't require a second `listSessions()` sweep per `/api/health`. */
  transcriptsFailed: number;
}
