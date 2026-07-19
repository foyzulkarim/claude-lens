import type { Store } from "../store/store.js";
import {
  gateStatusFromChecks,
  type GateReport,
  type GateReportSummary,
  type GateStatus,
  type GateThresholds,
} from "../../shared/gates-contract.js";
import { evaluateSessionGates } from "../gates/engine.js";
import { DEFAULT_GATE_THRESHOLDS, getGateThresholds } from "../gates/thresholds.js";
import { readConfig } from "../settings.js";

// ARCH-p4-12 §Data Models / §API Contracts / §Cross-Cutting. The cache is
// the only per-session stateful memo between the gates engine and the
// Sessions / Dashboard / Trends consumers. It exists because the engine is
// O(per-call) per session (cheap, but multiplicative across a fleet row
// hydration), and because the WS-debounced `session-updated` invalidation
// bus is the established hot-path for keeping derived state fresh.
//
// The cache stores `Promise<GateReportSummary | null>` per sessionId — the
// promise is the memoized value, so concurrent callers share the same
// in-flight evaluation (single-flight coalesce — review of the same
// pattern in client/api/sessions.ts and on the metrics engine). Returns
// `null` for unknown sessions so the Sessions route can render "—" without
// a try/catch on every row.

/**
 * Compute `GateReportSummary` from the engine's full `GateReport`. Pure for
 * testability — exposed as a named export so unit tests can pin the
 * derivation rules (counts, rollup, score echo) independent of the
 * Store + engine wiring.
 *
 * `status` is the rolled-up check verdict (`fail > warn > pass`, gates.md
 * §"Report Card scoring"); `passCount`/`warnCount`/`failCount` are the
 * tally of the seven raw gate entries the engine emits (E1 and E2 are
 * split rows; the engine itself collapses them internally for the score
 * formula — ARCH decision A4 keeps the summary aligned with the wire
 * shape rather than the rollup).
 */
export function toSummary(report: GateReport): GateReportSummary {
  const checks: GateStatus[] = report.gates.map((g) => g.status);
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const status of checks) {
    if (status === "pass") passCount += 1;
    else if (status === "warn") warnCount += 1;
    else failCount += 1;
  }
  return {
    sessionId: report.sessionId,
    score: report.score,
    scoreLetter: report.scoreLetter,
    status: gateStatusFromChecks(checks),
    passCount,
    warnCount,
    failCount,
    evaluatedAt: report.evaluatedAt,
  };
}

/**
 * Engine input + thresholds + a sessionId → GateReport with `evaluatedAt`
 * stamped. Mirrors `routes/gates.ts` so the cache and the route produce
 * identical reports (the route delegates to a similar flow today, gated
 * by the user's config; we replicate the dependency surface here rather
 * than import the route to avoid an HTTP-layer → cache layering cycle).
 *
 * Optional `userHomeDir` is a test seam for E1/E2's `~/.claude/CLAUDE.md`
 * lookup — production never sets it, matching `routes/gates.ts`.
 */
export interface EvaluateOptions {
  userHomeDir?: string;
}

export interface GatesCacheDeps {
  /** Snapshot source — the cache evaluates lazily via `store.getSessionSnapshot(id)`. */
  store: Store;
  /**
   * Resolve gate thresholds on demand. Production wires this to
   * `async () => getGateThresholds(await readConfig())` so a Settings edit
   * is observed on the next miss. Tests pass a synchronous fallback to
   * `DEFAULT_GATE_THRESHOLDS`.
   */
  resolveThresholds?: () => Promise<GateThresholds>;
  /** Test seam for E1/E2's `~/.claude/CLAUDE.md` lookup. */
  userHomeDir?: string;
}

export interface GatesCache {
  /**
   * Compute or return the cached `GateReportSummary` for one session.
   * `null` when the session is unknown to the Store. Single-flight:
   * concurrent callers share the same in-flight engine evaluation.
   */
  getSummary(sessionId: string): Promise<GateReportSummary | null>;
  /**
   * Batched variant for fleet-level consumers (Sessions route row hydration,
   * the `MetricsQuery.gatePassRate` aggregation). Returns a Map containing
   * only the ids that resolved — known-unknown sessions are absent.
   * Each entry shares a per-id in-flight evaluation with `getSummary`.
   */
  getSummariesBatch(ids: readonly string[]): Promise<Map<string, GateReportSummary>>;
  /** Drop the cached entry for one session. Called by the WS invalidation hook. */
  invalidate(sessionId: string): void;
  /** Test seam — drops every entry. Production never calls this. */
  clear(): void;
}

/**
 * Default threshold resolver — reads the user's config and falls back to
 * `DEFAULT_GATE_THRESHOLDS` on missing/malformed values. Used when the
 * caller's `resolveThresholds` is omitted (test seam; production always
 * provides one to match the `/api/sessions/:id/gates` route behavior).
 */
async function defaultResolveThresholds(): Promise<GateThresholds> {
  try {
    return getGateThresholds(await readConfig());
  } catch {
    return DEFAULT_GATE_THRESHOLDS;
  }
}

export function createGatesCache(deps: GatesCacheDeps): GatesCache {
  const store = deps.store;
  const resolveThresholds = deps.resolveThresholds ?? defaultResolveThresholds;
  const userHomeDir = deps.userHomeDir;

  // Promise-keyed memo — concurrent callers share the in-flight evaluation.
  // The error case is folded into a "reject-then-rethrow" so the next miss
  // re-runs cleanly; we don't poison the cache with a sentinel on error
  // (defense-in-depth: a transient config read failure shouldn't pin a
  // session to "stale" forever).
  const cache = new Map<string, Promise<GateReportSummary | null>>();

  function evaluate(sessionId: string): Promise<GateReportSummary | null> {
    const promise = (async (): Promise<GateReportSummary | null> => {
      const snapshot = store.getSessionSnapshot(sessionId);
      if (!snapshot) return null;
      const thresholds = await resolveThresholds();
      const evaluated = await evaluateSessionGates(
        {
          session: snapshot.session,
          turns: snapshot.turns,
          calls: snapshot.calls,
          toolResults: snapshot.toolResults,
          ...(userHomeDir !== undefined ? { userHomeDir } : {}),
        },
        thresholds,
      );
      // Engine returns `GateReportEvaluated` (sans `evaluatedAt` — ARCH A12).
      // Stamp the timestamp here, mirroring `routes/gates.ts:84-87`, so the
      // cache and the route produce identical `GateReport` derived shapes.
      const stamped: GateReport = {
        ...evaluated,
        evaluatedAt: new Date().toISOString(),
      };
      return toSummary(stamped);
    })().catch((err) => {
      // Drop the failed promise from the cache so the next miss re-runs.
      // We do NOT swallow — re-throw so callers see the error. (The route
      // has its own try/catch around `evaluateSessionGates`; cache callers
      // are expected to follow the same convention.)
      cache.delete(sessionId);
      throw err;
    });
    cache.set(sessionId, promise);
    return promise;
  }

  return {
    async getSummary(sessionId) {
      const existing = cache.get(sessionId);
      if (existing) return existing;
      return evaluate(sessionId);
    },

    async getSummariesBatch(ids) {
      const out = new Map<string, GateReportSummary>();
      // Kick off (or join) every id's evaluation concurrently — the cache
      // already single-flights per id, so any overlap is harmless.
      const settled = await Promise.allSettled(
        ids.map(async (id) => {
          const summary = await this.getSummary(id);
          if (summary) out.set(id, summary);
        }),
      );
      // If any individual id rejected, surface the first error so callers
      // (the metrics engine / the Sessions route) can decide whether to
      // 500 or degrade. Match the contract of `getSummary` — a reject is
      // an error, not a sentinel.
      for (const result of settled) {
        if (result.status === "rejected") throw result.reason;
      }
      return out;
    },

    invalidate(sessionId) {
      cache.delete(sessionId);
    },

    clear() {
      cache.clear();
    },
  };
}

// Re-export the default thresholds so callers (tests, build wiring) that
// need a synchronous fallback can import without reaching for the
// thresholds module directly.
export { DEFAULT_GATE_THRESHOLDS, getGateThresholds };

export type { GateReportSummary, GateThresholds };
