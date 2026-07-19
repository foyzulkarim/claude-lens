import type {
  GateReport,
  GateResult,
  GateThresholds,
  ScoreLetter,
} from "../../shared/gates-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import type { ToolResultBytesRecord } from "../ingest/parse-transcript.js";
import { evaluateC3 } from "./c3.js";
import { evaluateE1E2 } from "./e1e2.js";
import { evaluateK2 } from "./k2.js";
import { evaluateP3 } from "./p3.js";
import { evaluateV1 } from "./v1.js";
import { evaluateV2 } from "./v2.js";
import { preprocess } from "./preprocess.js";

/**
 * The gates engine — async (the E1/E2 filesystem check is the one piece
 * of I/O; everything else runs over already-parsed in-memory data) and
 * otherwise deterministic.
 *
 * Evaluates the seven gate IDs from `specs/gates.md` over the post-
 * `deriveSession()` store output plus an E1/E2 filesystem check, and
 * returns the report shape (per `shared/gates-contract.ts`). The
 * function deliberately:
 *
 *   - never reads the config (the caller resolves thresholds via
 *     `getGateThresholds`)
 *   - never calls `Date.now()` (the route layer stamps `evaluatedAt` —
 *     ARCH A12 keeps the engine fixture-regression friendly)
 *
 * Sidechain exclusion happens once in `preprocess`; downstream gates see
 * only main-chain data. C3's recurring-cost denominator intentionally
 * spans main + sidechain (ARCH A7) — every later call, regardless of
 * stream, pays the cache-read cost once.
 */

/** Report Card output sans `evaluatedAt` — the route layer stamps that. */
export type GateReportEvaluated = Omit<GateReport, "evaluatedAt">;

export interface EngineInput {
  /** The session's persisted rollup. `session.project` is the only field used (it stores the transcript's cwd). */
  session: Session;
  /** All turns, sidechain and main — engine splits them in `preprocess`. */
  turns: Turn[];
  /** All calls, sidechain and main — same split, plus C3 needs both for its denominator. */
  calls: ApiCall[];
  /** Per-tool_use result records; indexed by toolUseId. C3 sums sizes; V2 reads isError. */
  toolResults: ToolResultBytesRecord[];
  /**
   * Optional override for the user-level CLAUDE.md path (passed through
   * to E1/E2). Defaults to `${homedir()}/.claude/CLAUDE.md`. Tests pass a
   * temp directory so the engine doesn't read the real user's home config;
   * production code never sets this.
   */
  userHomeDir?: string;
}

/**
 * Roll-up check status combining E1 and E2 into the gates.md §Report Card
 * scoring single row. Per gates.md preamble: "E1 and E2 share one check
 * with three outcomes" — fail/warn/pass at the check level.
 */
function rollupE1E2(e1: GateResult, e2: GateResult): "pass" | "warn" | "fail" {
  if (e1.status === "fail") return "fail";
  if (e2.status === "warn") return "warn";
  return "pass";
}

/** Score-band thresholds for the `passes / (passes + 0.5·warns + fails)` ratio. */
const SCORE_BANDS: ReadonlyArray<readonly [number, ScoreLetter]> = [
  [0.9, "A"],
  [0.75, "B"],
  [0.5, "C"],
  [0.25, "D"],
];

function bucketScore(score: number): ScoreLetter {
  for (const [threshold, letter] of SCORE_BANDS) {
    if (score >= threshold) return letter;
  }
  return "F";
}

/**
 * Production entry point. Awaits the E1/E2 filesystem check; everything
 * else is in-memory. Returns the report shape WITHOUT `evaluatedAt` —
 * the route layer stamps it (ARCH A12) so the engine stays deterministic
 * across fixture regression runs. The empty-string placeholder from the
 * prior shape (review M4) is gone: the type-level distinction means a
 * wire-format consumer can never see `evaluatedAt: ""`.
 */
export async function evaluateSessionGates(
  input: EngineInput,
  thresholds: GateThresholds,
): Promise<GateReportEvaluated> {
  const pre = preprocess(input.calls, input.turns);

  const v1 = evaluateV1(pre.mainTurns);
  const v2 = evaluateV2(pre.mainTurns, input.toolResults, thresholds);
  const p3 = evaluateP3(pre.mainTurns);
  const c3 = evaluateC3(pre, input.toolResults, thresholds);
  const k2 = evaluateK2(pre.mainTurns, pre.mainCalls, thresholds, pre.mainTurnNByMessageId);
  // evaluateE1E2 returns `[E1, E2]` as a tuple; destructuring replaces
  // the prior positional `e1e2Results[0] ?? inactive` / `[1] ?? ...`
  // fallback shape (review M2) which silently masked contract drift.
  const [e1Result, e2Result] = await evaluateE1E2(input.session.project, thresholds, {
    userClaudePath:
      input.userHomeDir !== undefined ? `${input.userHomeDir}/.claude/CLAUDE.md` : undefined,
  });

  // Build the 7-entry `gates` list in the prose order from gates.md.
  // E1/E2 contributes two entries; exactly one carries the active outcome.
  const gates: GateResult[] = [v1, v2, p3, c3, k2, e1Result, e2Result];

  // Six check statuses: roll E1 + E2 into one for the score formula.
  const checks: ("pass" | "warn" | "fail")[] = [
    v1.status,
    v2.status,
    p3.status,
    c3.status,
    k2.status,
    rollupE1E2(e1Result, e2Result),
  ];

  let passes = 0;
  let warns = 0;
  let fails = 0;
  for (const status of checks) {
    if (status === "pass") passes += 1;
    else if (status === "warn") warns += 1;
    else fails += 1;
  }

  // gates.md §Report Card scoring: `passes / (passes + 0.5·warns + fails)`.
  // A warn counts half-weight in the denominator so a single warn on an
  // otherwise-passing session doesn't drop the score as much as a fail.
  const denominator = passes + 0.5 * warns + fails;
  const score = denominator > 0 ? passes / denominator : 0;

  return {
    sessionId: input.session.sessionId,
    gates,
    score,
    scoreLetter: bucketScore(score),
    thresholdsUsed: thresholds,
  };
}
