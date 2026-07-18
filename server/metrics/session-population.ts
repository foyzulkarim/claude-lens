import type {
  SessionPopulationCriteria,
  SessionPopulationFilter,
} from "../../shared/sessions-contract.js";
import type { Measure } from "../../shared/metrics-contract.js";
import type { ApiCall, Session, Turn } from "../../shared/types.js";
import type { MeasureScope, PricingTable } from "./measures.js";
import { computeMeasure } from "./measures.js";

/**
 * Session population semantics (ARCH T1, A2 single population).
 *
 * This module is the single source of truth for "which sessions participate
 * in a Sessions-page section, and what records belong to each of them".
 * Both `server/routes/sessions.ts` (table/timeline/compare projection) and
 * `server/metrics/engine.ts` (distribution + scatter) normalize their
 * inputs through `matchSession`/`indexSessionsByScope`, so range,
 * categorical, cost, gate, and drilldown semantics never drift between
 * sections.
 *
 * Pure helpers — no Store, no Fastify, no filesystem, no client modules
 * (architecture §3 Module Boundaries).
 */

// ---------------------------------------------------------------------------
// Match predicate
// ---------------------------------------------------------------------------

/**
 * Returns true iff `session` matches every active criterion in `criteria`.
 * The criteria shape mirrors `SessionPopulationFilter` minus the range —
 * range filtering happens upstream on `session.firstAt` (the canonical
 * session-start field, matching `engine.ts`'s `scopeFor` convention and
 * the sessions route's existing `sessionMatchesFilters`).
 *
 * Categorical matching is OR-aggregate (any-of), matching
 * `dimensions.ts`'s `matchesFilter`. Empty-array criteria are treated as
 * "no filter applied" (caller already filtered, the wrapper should
 * normalize away undefined/empty).
 *
 * `hasDrilldown` is derived as `turnCount > 0` (ARCH R9) — this is the
 * one place that definition lives, and every downstream section reads it
 * identically.
 */
export function matchSession(session: Session, criteria: SessionPopulationCriteria): boolean {
  if (criteria.project !== undefined && !criteria.project.includes(session.project)) {
    return false;
  }
  if (criteria.branch !== undefined && !criteria.branch.includes(session.gitBranch)) {
    return false;
  }
  if (
    criteria.model !== undefined &&
    !session.models.some((m) => criteria.model?.includes(m) ?? false)
  ) {
    return false;
  }
  if (criteria.host !== undefined && !criteria.host.includes(session.host)) {
    return false;
  }
  if (criteria.entrypoint !== undefined && !criteria.entrypoint.includes(session.entrypoint)) {
    return false;
  }
  if (criteria.minCostComputed !== undefined && session.costComputed < criteria.minCostComputed) {
    return false;
  }
  if (criteria.maxCostComputed !== undefined && session.costComputed > criteria.maxCostComputed) {
    return false;
  }
  if (criteria.hasDrilldown !== undefined && session.turnCount > 0 !== criteria.hasDrilldown) {
    return false;
  }
  if (criteria.sessionId !== undefined && !criteria.sessionId.includes(session.sessionId)) {
    return false;
  }
  return true;
}

/**
 * Resolve `SessionPopulationFilter` (which carries a `range`) down to
 * `SessionPopulationCriteria` plus a `{from, to}` epoch-ms range, applying
 * the range filter to a pre-fetched session list and returning only the
 * surviving sessions. The range check uses `Date.parse` numeric comparison
 * (matches `server/routes/sessions.ts`'s `sessionMatchesFilters` —
 * review #14), with both bounds inclusive.
 *
 * `from`/`to` are the canonical milliseconds used by the metrics engine's
 * own `scopeFor`, so downstream callers can reuse them without a second
 * parse pass.
 */
export function applyRange(
  filter: SessionPopulationFilter,
  sessions: Session[],
): { matched: Session[]; fromMs: number; toMs: number } {
  const fromMs = Date.parse(filter.range.from);
  const toMs = Date.parse(filter.range.to);

  const matched: Session[] = [];
  for (const session of sessions) {
    const firstMs = Date.parse(session.firstAt);
    // NaN < x / NaN > x are both false — an unparseable firstAt means the
    // session is excluded by the range (review finding H2).
    if (!Number.isFinite(firstMs)) continue;
    if (firstMs < fromMs || firstMs > toMs) continue;
    if (!matchSession(session, filter)) continue;
    matched.push(session);
  }
  return { matched, fromMs, toMs };
}

// ---------------------------------------------------------------------------
// Per-session scope indexing
// ---------------------------------------------------------------------------

/** A pre-indexed, request-local scope for one session. */
export interface SessionScope {
  session: Session;
  calls: ApiCall[];
  turns: Turn[];
}

/**
 * Index per-session records once, in linear time, so subsequent
 * distribution/scatter iterations over the matched population never
 * re-scan every call/turn for every session (engine.ts's pre-existing
 * `entityScopesFor("session", ...)` filters `scope.calls` and `scope.turns`
 * once per session — that's O(S × (C+T)) for S sessions and grows linearly
 * with population size, which the existing engine tests don't notice only
 * because the test fixtures are small).
 *
 * `calls` and `turns` are the unfiltered, request-local reads from
 * `Store.listCalls()` / `Store.listTurns()` (caller responsibility —
 * matches the existing engine.ts convention).
 */
export function indexSessionsByScope(
  matched: Session[],
  calls: ApiCall[],
  turns: Turn[],
): Map<string, SessionScope> {
  // Group calls by sessionId once. The session-derived turns array
  // already carries its owning sessionId, so we filter that list per
  // session — turn→call mapping is already maintained by
  // `engine.ts`'s `buildCallToTurn`, and turns are far smaller than calls.
  const callsBySession = new Map<string, ApiCall[]>();
  for (const call of calls) {
    const bucket = callsBySession.get(call.sessionId);
    if (bucket) {
      bucket.push(call);
    } else {
      callsBySession.set(call.sessionId, [call]);
    }
  }

  const scopes = new Map<string, SessionScope>();
  for (const session of matched) {
    scopes.set(session.sessionId, {
      session,
      calls: callsBySession.get(session.sessionId) ?? [],
      turns: turns.filter((turn) => turn.sessionId === session.sessionId),
    });
  }
  return scopes;
}

/**
 * Read the requested measure off a `SessionScope` and return its value
 * for the canonical "single-session MeasureScope" shape consumed by
 * `computeMeasure`. Treats `null`/`undefined` measure values as the
 * honest "unavailable" signal — the caller decides whether to skip the
 * point or surface an empty/null cell.
 *
 * Note: `totalTokens` is intentionally NOT a Measure literal (the metrics
 * contract pins `MEASURES.length === 19`). The page needs it for the
 * table column and the "tokens × turns" preset; that lives in
 * `server/metrics/scatter.ts`'s `presetTokensForSession` so the contract
 * stays untouched.
 */
export function measureForSession(
  measure: Measure,
  scope: SessionScope,
  pricing: PricingTable,
): number | null {
  const measureScope: MeasureScope = {
    calls: scope.calls,
    turns: scope.turns,
    sessions: [scope.session],
  };
  return computeMeasure(measure, measureScope, pricing);
}

/**
 * `Session.usage` sums the four token categories — used by the page table
 * and by the "tokens × turns" scatter preset. Lives here (not as a
 * Measure literal) per ARCH A11 + the `MEASURES.length === 19` test pin.
 */
export function totalTokensForSession(session: Session): number {
  const u = session.usage;
  return (
    (u.inputTokens ?? 0) +
    (u.outputTokens ?? 0) +
    (u.cacheReadTokens ?? 0) +
    (u.cacheCreateTokens ?? 0)
  );
}
