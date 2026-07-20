import type { Store } from "../store/store.js";
import {
  gateStatusFromChecks,
  type GateReport,
  type GateReportSummary,
  type GateStatus,
  type GateThresholds,
} from "../../shared/gates-contract.js";
import type { GateSummaryLite } from "../../shared/gates-cache-contract.js";
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
   * Partial-failure tolerant (#P4-12 review finding #11): one bad session
   * does not 500 the entire batch — the resolved summaries for every
   * successful id are returned, and the failed ids are simply absent
   * (matching the "known-unknown → absent" contract above).
   */
  getSummariesBatch(ids: readonly string[]): Promise<Map<string, GateReportSummary>>;
  /** Drop the cached entry for one session. Called by the WS invalidation hook. */
  invalidate(sessionId: string): void;
  /** Test seam — drops every entry. Production never calls this. */
  clear(): void;
}

/** Soft concurrency cap on the batch evaluator. Each id's evaluation
 * awaits a `resolveThresholds()` call + filesystem checks (E1/E2), so
 * launching N concurrent evaluators on a cold cache with N=10K+ risks
 * OOM and thundering-herd config reads (#P4-12 review finding #7). The
 * number is small enough to keep the work in-flight cheap, large
 * enough to overlap I/O without serializing the whole fleet.
 * ARCH OQ1 flags unbounded fan-out as the 10M-row follow-up — this is
 * the bounded MVP. */
const BATCH_CONCURRENCY = 32;

/** LRU cap on the per-session cache Map (#P4-12 review finding #24).
 * Mirrors the established `analysis.ts` upper bound — the cache is
 * hot enough that on a long-running process an unbounded Map would
 * silently grow until process pressure triggered GC pauses. Each
 * insert evicts the oldest entry; the WS invalidation bus already
 * keeps summary freshness on its own. */
const CACHE_MAX_ENTRIES = 50_000;

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
  //
  // LRU cap (#P4-12 review finding #24): `Map` iteration order is insertion
  // order, so on insert past the cap we evict the oldest entry by
  // re-inserting (Map.delete + set) which promotes the new entry to the
  // "most-recently-inserted" position. This is O(1) per insert and bounds
  // memory at `CACHE_MAX_ENTRIES` entries on long-running processes.
  const cache = new Map<string, Promise<GateReportSummary | null>>();

  function setCached(sessionId: string, promise: Promise<GateReportSummary | null>): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      // Evict the oldest entry (Map iteration order = insertion order).
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(sessionId, promise);
  }

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
    setCached(sessionId, promise);
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
      // Concurrency cap (#P4-12 review finding #7): launch at most
      // BATCH_CONCURRENCY evaluators at a time. The cache already
      // single-flights per-id (concurrent calls for the same id share
      // the in-flight promise), so chunking is the only knob left.
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += BATCH_CONCURRENCY) {
        chunks.push(ids.slice(i, i + BATCH_CONCURRENCY));
      }
      for (const chunk of chunks) {
        const settled = await Promise.allSettled(
          chunk.map(async (id) => {
            const summary = await this.getSummary(id);
            if (summary) out.set(id, summary);
          }),
        );
        // Partial-failure tolerance (#P4-12 review finding #11): a single
        // bad id no longer 500s the entire batch. We previously surfaced
        // the first rejection, which made one malformed session take down
        // a 10K-row page. Instead, we log and drop — the resolved entries
        // still ship to the caller, matching the "known-unknown → absent"
        // shape already documented for `null`/missing sessions.
        for (const result of settled) {
          if (result.status === "rejected") {
            // Drop on the floor with a tagged log; callers see one fewer
            // entry in the Map, not an HTTP 500. The `console.warn` is
            // intentional (not a debug print) — pino is not threaded
            // through this module and a partial-batch failure is a
            // sign of a real underlying issue (malformed session) that
            // operators should see.
            console.warn("[gates-cache] partial batch failure", {
              reason:
                result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
          }
        }
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

export type { GateReportSummary, GateSummaryLite, GateThresholds };
