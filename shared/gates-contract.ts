/**
 * Gates engine wire contract (ARCH-gates-engine.md §Data Models).
 *
 * Parallel to `cache-lab-contract.ts` — these types are the public surface
 * of the gates engine. The engine itself (`server/gates/`) imports them; the
 * `/api/sessions/:id/gates` route serializes them verbatim; #P4-12's UI
 * deserializes them. Renaming or reshaping any of these is a wire break.
 *
 * `GateEvidence` is intentionally an asymmetric shape — V1/V2/P3/C3/K2 set
 * `turnN` + `callId`; E1/E2 sets only `filePath` + `detail`. The optional
 * fields are typed optional rather than `null` so the wire payload stays
 * compact for the session-scoped gate.
 *
 * `evaluatedAt` is stamped by the route layer, not the engine — the engine
 * must stay deterministic for fixture regression tests, which assert a
 * stable output across runs (ARCH A12).
 */

export const GATE_IDS = ["V1", "V2", "P3", "C3", "K2", "E1", "E2"] as const;

export type GateId = (typeof GATE_IDS)[number];

export type GateStatus = "pass" | "warn" | "fail";

/**
 * One piece of evidence a gate produces. Per gates.md §1: V1/V2/P3/C3/K2
 * evidence is turn-keyed (`turnN`, `callId`); E1/E2 is session-scoped
 * (`filePath`, `detail` only). `detail` is always present — it's the
 * human-readable explanation a UI surfaces in the gate's drill-down.
 */
export interface GateEvidence {
  /** 1-indexed main-chain turn number. Set by V1, V2, P3, C3, K2. Never by E1/E2. */
  turnN?: number;
  /** `ApiCall.messageId` of the offending call. Turn-keyed gates only. */
  callId?: string;
  /** Resolved or cwd-relative path. Set by P3 and E1/E2. */
  filePath?: string;
  /** Human-readable explanation. Always present. */
  detail: string;
}

/**
 * One gate's verdict for a session. `evidence` may be empty when the gate
 * is a clean pass with nothing to surface (e.g. V1 on a session with zero
 * edits, K2 on a session with no spikes) — the engine never emits N/A at
 * the gate-result level; N/A only applies to per-turn denominators inside
 * the score formula (gates.md §"Report Card scoring").
 */
export interface GateResult {
  gateId: GateId;
  status: GateStatus;
  evidence: GateEvidence[];
}

/**
 * Resolved threshold values for every configurable gate. Defaults are
 * defined in `server/gates/thresholds.ts` (`DEFAULT_GATE_THRESHOLDS`)
 * and match `specs/gates.md` §"Configurable constants".
 */
export interface GateThresholds {
  v2Repeat: number;
  c3MaxChars: number;
  k2Spike: number;
  e2MaxChars: number;
  e2MaxLines: number;
}

/**
 * Report Card letter bucket. Engine outputs both the fraction and the
 * letter so #P4-12's UI doesn't have to re-bucket (ARCH A11).
 */
export type ScoreLetter = "A" | "B" | "C" | "D" | "F";

/**
 * Top-level engine output for one session. `gates` always has exactly
 * seven entries, one per `GateId`, in the prose order from `gates.md`
 * (V1, V2, P3, C3, K2, E1, E2). `score` is computed across the six
 * checks — E1/E2 collapse to one for scoring purposes.
 */
export interface GateReport {
  sessionId: string;
  gates: GateResult[];
  /** `passes / (passes + 0.5·warns + fails)` across six checks; 0 when no checks fired. */
  score: number;
  scoreLetter: ScoreLetter;
  /** ISO-8601 timestamp, stamped by the route layer (engine is deterministic). */
  evaluatedAt: string;
  /** Echoed so the UI can label "evaluated with defaults" vs custom values. */
  thresholdsUsed: GateThresholds;
}

/**
 * Compact per-session summary — the shape `server/cache/gates-cache.ts`
 * serves to consumers that don't need evidence (Sessions list rows,
 * Dashboard gate-failure feed, `MetricsQuery.gatePassRate`). Renamed or
 * reshaped only as a wire break for the cache API surface (ARCH A9).
 *
 * Re-exported here so most call sites keep a single `gates-contract`
 * import. The authoritative type lives in `gates-cache-contract.ts`.
 */
export type { GateReportSummary } from "./gates-cache-contract.js";

/**
 * Roll up six check statuses (V1, V2, P3, C3, K2, E1/E2 combined) into
 * the single session-level `GateStatus` per gates.md §"Report Card
 * scoring": any fail → fail; else any warn → warn; else pass. Used by
 * `gatesCache` to derive `GateReportSummary.status` from `GateReport`
 * without re-running the engine. Pure for testability.
 */
export function gateStatusFromChecks(checks: readonly GateStatus[]): GateStatus {
  if (checks.some((s) => s === "fail")) return "fail";
  if (checks.some((s) => s === "warn")) return "warn";
  return "pass";
}
