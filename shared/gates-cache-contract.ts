/**
 * Gates cache wire contract — compact projection of `GateReport` for
 * consumers that don't need evidence (ARCH-p4-12 §Data Models; ARCH A9).
 *
 * The engine route at `/api/sessions/:id/gates` continues to return the
 * full `GateReport` from `gates-contract.ts`; this contract exists only
 * for the `server/cache/gates-cache.ts` module, which serves per-session
 * summaries to the Sessions list row hydration, the Dashboard gate-failure
 * feed, and the `MetricsQuery.gatePassRate` aggregation.
 *
 * The shape is intentionally a strict subset of `GateReport`: any non-
 * evidence field survives, evidence is dropped (callers that need it fetch
 * the full report on demand). `status` is the rollup of the six checks
 * per gates.md §"Report Card scoring" — any fail → fail, else any warn →
 * warn, else pass.
 *
 * Renaming or reshaping any of these types is a wire break for the cache
 * API surface.
 */

import type { GateStatus, ScoreLetter } from "./gates-contract.js";

/**
 * Compact per-session gate summary — what `gatesCache.getSummary(id)`
 * returns. Evidence is intentionally absent; consumers that need it
 * fetch the full `GateReport` from `/api/sessions/:id/gates`.
 */
export interface GateReportSummary {
  /** The session this summary describes. */
  sessionId: string;
  /** `passes / (passes + 0.5·warns + fails)` across six checks; 0 when no checks fired. */
  score: number;
  /** Letter bucket of `score`. */
  scoreLetter: ScoreLetter;
  /** Rollup of six checks: any fail → fail; else any warn → warn; else pass. */
  status: GateStatus;
  /** Tally of checks across the six (V1, V2, P3, C3, K2, E1/E2 combined). */
  passCount: number;
  warnCount: number;
  failCount: number;
  /** ISO-8601 timestamp stamped by the route layer that produced the underlying report. */
  evaluatedAt: string;
}

/**
 * Slim projection of `GateReportSummary` — the two fields the metrics
 * engine (`server/metrics/engine.ts`, `server/metrics/measures.ts`) and
 * the Sessions row hydration actually read. Exists so the
 * `Map<sessionId, GateSummaryLite>` plumbing doesn't inline
 * `{ score: number; status: string }` across six call sites, which
 * widens `GateStatus` to `string` (#P4-12 review finding #16).
 */
export type GateSummaryLite = Pick<GateReportSummary, "score" | "status">;
