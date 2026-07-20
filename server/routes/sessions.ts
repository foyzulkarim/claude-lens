import type { FastifyInstance } from "fastify";
import type {
  SessionListItem,
  SessionListMeta,
  SessionListParams,
  SessionListResponse,
  SessionPageItem,
  SessionPageParams,
  SessionPageResponse,
  SessionPopulationFilter,
  SessionTimelineItem,
  SessionTimelineSet,
  TracePoint,
} from "../../shared/sessions-contract.js";
import type { GateSummaryLite } from "../../shared/gates-cache-contract.js";
import { isValidTagList } from "../../shared/local-store-contract.js";
import type { Session } from "../../shared/types.js";
import type { GatesCache } from "../cache/gates-cache.js";
import { mutateLocalStore, readLocalStore } from "../local-store.js";
import type { PricingTable } from "../metrics/measures.js";
import { applyRange, totalTokensForSession } from "../metrics/session-population.js";
import type { Pricer } from "../store/derive-session.js";
import { aggregateLogicalTurnCost, groupLogicalTurns } from "../store/logical-turns.js";
import type { Store } from "../store/store.js";
import { extractField } from "../util.js";

// GET /api/sessions — general paginated sessions list (ARCH T6 / #P4-2).
// Patterned on routes/metrics.ts (Fastify plugin, manual validation that
// returns 400 with a typed error, no Fastify schema because we need CSV
// array splitting that the schema DSL can't express cleanly). READ-ONLY
// — never mutates Store. Project/sort/filter/page happens here, not in the
// Store, so the Store stays a pure columnar source.
//
// #P4-4 (issue #36, ARCH-sessions-page.md) adds an opt-in `?view=page`
// projection for the Sessions page: wider sort/filter union, strict
// SessionPageItem rows, optional timeline projection, and bounded
// compare hydration. The default `view=summary` projection keeps the
// compact SessionListResponse untouched.

export const SESSIONS_DEFAULT_LIMIT = 25;
export const SESSIONS_MAX_LIMIT = 100;
/** include=trace is only safe on small pages; cap it below the default limit cap. */
export const SESSIONS_TRACE_MAX_LIMIT = 25;
/** Per-item trace point cap — bounds the cumulative priced turn array. */
export const SESSIONS_MAX_TRACE_POINTS = 50;
/** Page projection timeline cap — bounds the visible Gantt bar count
 * (ARCH A5/R11) without affecting aggregate totals. */
export const SESSIONS_TIMELINE_CAP = 500;
/** Maximum session IDs accepted in compare hydration (ARCH A10). */
export const SESSIONS_COMPARE_ID_MAX = 3;

export interface RegisterSessionsRouteOptions {
  /**
   * Pricing table for trace projection. When provided (the production
   * case via `BuildAppOptions.metadata.pricing`), each turn's cumulative
   * priced cost is computed with the same rates the Store used on
   * derivation. Optional: when omitted, `trace[].cost` is 0 for every
   * point — the honest "no pricing yet" state, never fabricated.
   */
  pricing?: PricingTable;
  /**
   * Per-usage pricer used to compute each turn's priced cost for the
   * trace. Injected from `BuildAppOptions.metadata.pricer` so the trace
   * uses the exact same accumulator as `deriveSession`'s `costComputed`.
   */
  pricer?: Pricer;
  /** Overrides `~/.claude-lens/local.json`'s path (#P4-15) — tests only; production always uses the real path. */
  localStorePath?: string;
  /**
   * Per-session gate summary cache (ARCH-p4-12 §Cross-Cutting). Populates
   * `gateStatus`/`gateScore` on every row projection; cold cache misses
   * trigger a one-shot `evaluateSessionGates` (the cache itself is
   * single-flight via `server/cache/gates-cache.ts`).
   */
  gatesCache?: GatesCache;
}

const SUMMARY_SORT_KEYS = new Set<NonNullable<SessionListParams["sort"]>>([
  "lastAt",
  "costComputed",
  "durationMs",
  "cacheSavingsComputed",
  "maxTurnCostComputed",
]);
export const PAGE_SORT_KEYS = new Set<NonNullable<SessionPageParams["sort"]>>([
  "lastAt",
  "costComputed",
  "costObserved",
  "durationMs",
  "totalTokens",
  "turnCount",
  "cacheHitPct",
  "cacheSavingsComputed",
  "maxTurnCostComputed",
  "gateScore",
  "branch",
  "version",
]);
const ORDER_KEYS = new Set<NonNullable<SessionListParams["order"]>>(["asc", "desc"]);

type SummarySortKey = NonNullable<SessionListParams["sort"]>;
type PageSortKey = NonNullable<SessionPageParams["sort"]>;

/**
 * Parses the Fastify query object into a typed `SessionListParams`. Returns
 * either the validated params or a human-readable error message — never
 * throws. Mirrors `parseMetricsQuery`'s shape so the route can return a 400
 * with `{ error }` in the same convention. Only handles the default
 * `view=summary` projection; page-mode queries must go through
 * `parseSessionsPageQuery`.
 */
export function parseSessionsQuery(raw: unknown): SessionListParams | string {
  if (raw === null || typeof raw !== "object") return "query must be an object";
  const q = raw as Record<string, unknown>;
  if (q.view !== undefined && q.view !== "summary" && q.view !== "page") {
    return 'view must be "summary" or "page" when present';
  }
  // The page projection has its own dedicated parser — this one is summary-only.
  if (q.view === "page") {
    return "view=summary parser does not handle view=page; use parseSessionsPageQuery";
  }
  const params: SessionListParams = {};

  if (q.sort !== undefined) {
    if (typeof q.sort !== "string" || !SUMMARY_SORT_KEYS.has(q.sort as SummarySortKey)) {
      return "sort must be one of lastAt, costComputed, durationMs, cacheSavingsComputed, maxTurnCostComputed";
    }
    params.sort = q.sort as SummarySortKey;
  }

  if (q.order !== undefined) {
    if (
      typeof q.order !== "string" ||
      !ORDER_KEYS.has(q.order as NonNullable<SessionListParams["order"]>)
    ) {
      return 'order must be "asc" or "desc"';
    }
    params.order = q.order as NonNullable<SessionListParams["order"]>;
  }

  if (q.offset !== undefined) {
    const n = parseNonNegativeInt(q.offset);
    if (typeof n === "string") return n;
    params.offset = n;
  }

  if (q.limit !== undefined) {
    const n = parsePositiveInt(q.limit);
    if (typeof n === "string") return n;
    params.limit = n;
  }

  if (q.from !== undefined) {
    if (typeof q.from !== "string" || !Number.isFinite(Date.parse(q.from))) {
      return "from must be a parseable ISO date string";
    }
    params.from = q.from;
  }

  if (q.to !== undefined) {
    if (typeof q.to !== "string" || !Number.isFinite(Date.parse(q.to))) {
      return "to must be a parseable ISO date string";
    }
    params.to = q.to;
  }

  if (params.from !== undefined && params.to !== undefined) {
    if (Date.parse(params.from) > Date.parse(params.to)) {
      return "from must be <= to";
    }
  }

  for (const key of ["project", "model", "branch", "host"] as const) {
    if (q[key] !== undefined) {
      if (typeof q[key] !== "string") {
        return `${key} must be a comma-separated string`;
      }
      // Reject empty after trim — an empty filter list is indistinguishable
      // from "no filter applied", and silently letting it through would let
      // `?project=` mean "give me everything" when the user almost certainly
      // intended something else.
      const items = q[key]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) {
        return `${key} must contain at least one non-empty value`;
      }
      params[key] = items;
    }
  }

  if (q.include !== undefined) {
    if (q.include !== "trace") {
      return 'include must be "trace" when present';
    }
    params.include = "trace";
  }

  return params;
}

/**
 * Parses the Fastify query object into a typed `SessionPageParams` for the
 * Sessions page projection (ARCH A1, `view=page`). Same "string-on-error,
 * never-throws" contract as `parseSessionsQuery`.
 *
 * Validation surface (any failure → 400):
 *  - `view` must be `"page"` (rejects any other value)
 *  - `sort` must be one of `PAGE_SORT_KEYS`
 *  - page-only filters (`entrypoint`, `minCostComputed`, `maxCostComputed`,
 *    `hasDrilldown`, `gateStatus`, `sessionId`) must be the right shape
 *  - `minCostComputed <= maxCostComputed` when both present
 *  - `sessionId` is unique, non-empty, ≤ SESSIONS_COMPARE_ID_MAX
 *  - `include` is `"timeline"` (not `trace`) for the page projection
 *  - Incompatible view/include pairs are rejected (`view=page&include=trace`
 *    is rejected in the route, not here, because it crosses projection
 *    boundaries)
 */
export function parseSessionsPageQuery(raw: unknown): SessionPageParams | string {
  if (raw === null || typeof raw !== "object") return "query must be an object";
  const q = raw as Record<string, unknown>;
  if (q.view !== "page") {
    return 'view=page queries must declare view="page"';
  }
  const params: SessionPageParams = { view: "page" };

  if (q.sort !== undefined) {
    if (typeof q.sort !== "string" || !PAGE_SORT_KEYS.has(q.sort as PageSortKey)) {
      return "sort must be one of lastAt, costComputed, costObserved, durationMs, totalTokens, turnCount, cacheHitPct, cacheSavingsComputed, maxTurnCostComputed, gateScore, branch, version";
    }
    params.sort = q.sort as PageSortKey;
  }

  if (q.order !== undefined) {
    if (
      typeof q.order !== "string" ||
      !ORDER_KEYS.has(q.order as NonNullable<SessionPageParams["order"]>)
    ) {
      return 'order must be "asc" or "desc"';
    }
    params.order = q.order as NonNullable<SessionPageParams["order"]>;
  }

  if (q.offset !== undefined) {
    const n = parseNonNegativeInt(q.offset);
    if (typeof n === "string") return n;
    params.offset = n;
  }

  if (q.limit !== undefined) {
    const n = parsePositiveInt(q.limit);
    if (typeof n === "string") return n;
    params.limit = n;
  }

  if (q.from !== undefined) {
    if (typeof q.from !== "string" || !Number.isFinite(Date.parse(q.from))) {
      return "from must be a parseable ISO date string";
    }
    params.from = q.from;
  }

  if (q.to !== undefined) {
    if (typeof q.to !== "string" || !Number.isFinite(Date.parse(q.to))) {
      return "to must be a parseable ISO date string";
    }
    params.to = q.to;
  }

  if (params.from !== undefined && params.to !== undefined) {
    if (Date.parse(params.from) > Date.parse(params.to)) {
      return "from must be <= to";
    }
  }

  for (const key of ["project", "model", "branch", "host", "entrypoint", "gateStatus"] as const) {
    if (q[key] !== undefined) {
      if (typeof q[key] !== "string") {
        return `${key} must be a comma-separated string`;
      }
      const items = q[key]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (items.length === 0) {
        return `${key} must contain at least one non-empty value`;
      }
      // `gateStatus` is a reserved seam (R8/A11) — accepted for forward
      // compatibility with #P4-12 but never filters the population today.
      params[key] = items;
    }
  }

  if (q.minCostComputed !== undefined) {
    if (typeof q.minCostComputed !== "string" && typeof q.minCostComputed !== "number") {
      return "minCostComputed must be a number";
    }
    const v = Number(q.minCostComputed);
    if (!Number.isFinite(v) || v < 0) {
      return "minCostComputed must be a finite non-negative number";
    }
    params.minCostComputed = v;
  }

  if (q.maxCostComputed !== undefined) {
    if (typeof q.maxCostComputed !== "string" && typeof q.maxCostComputed !== "number") {
      return "maxCostComputed must be a number";
    }
    const v = Number(q.maxCostComputed);
    if (!Number.isFinite(v) || v < 0) {
      return "maxCostComputed must be a finite non-negative number";
    }
    params.maxCostComputed = v;
  }

  if (
    params.minCostComputed !== undefined &&
    params.maxCostComputed !== undefined &&
    params.minCostComputed > params.maxCostComputed
  ) {
    return "minCostComputed must be <= maxCostComputed";
  }

  if (q.hasDrilldown !== undefined) {
    if (typeof q.hasDrilldown !== "string" && typeof q.hasDrilldown !== "boolean") {
      return "hasDrilldown must be a boolean";
    }
    // Fastify parses query strings — accept both the parsed boolean and
    // the raw "true"/"false" strings the URL produces.
    const raw = q.hasDrilldown;
    if (typeof raw === "string") {
      if (raw !== "true" && raw !== "false") {
        return 'hasDrilldown must be "true" or "false" when present';
      }
      params.hasDrilldown = raw === "true";
    } else {
      params.hasDrilldown = raw;
    }
  }

  if (q.sessionId !== undefined) {
    if (typeof q.sessionId !== "string") {
      return "sessionId must be a comma-separated string";
    }
    const items = q.sessionId
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (items.length === 0) {
      return "sessionId must contain at least one non-empty value";
    }
    if (items.length > SESSIONS_COMPARE_ID_MAX) {
      return `sessionId must contain at most ${SESSIONS_COMPARE_ID_MAX} values`;
    }
    const unique = new Set(items);
    if (unique.size !== items.length) {
      return "sessionId must not contain duplicates";
    }
    params.sessionId = items;
  }

  if (q.include !== undefined) {
    if (q.include !== "timeline") {
      return 'include must be "timeline" for view=page';
    }
    params.include = "timeline";
  }

  return params;
}

function parseNonNegativeInt(value: unknown): number | string {
  // Fastify's default query parser turns everything into strings; allow both
  // for callers that hand-build the object in tests.
  if (typeof value !== "string" && typeof value !== "number") {
    return "expected a number";
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return "expected a non-negative integer";
  }
  return n;
}

function parsePositiveInt(value: unknown): number | string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "expected a number";
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return "expected a positive integer";
  }
  return n;
}

/**
 * True iff the session matches the summary-projection filters. `from`/`to`
 * use the session-start convention (`session.firstAt`, matching how the
 * metrics engine buckets sessions in `scopeFor`), inclusive on BOTH bounds.
 *
 * Review #14 / CQ7: pre-fix the route compared raw ISO strings (which sort
 * correctly today but is fragile — ISO with vs without sub-second precision
 * or trailing `Z` could order incorrectly) and used a half-open upper bound
 * that conflicted with the metrics engine's inclusive convention. Post-fix:
 *   - Parse both `from`/`to` and `session.firstAt` to epoch ms once, then
 *     compare numerically (matches `Date.parse` semantics, immune to ISO
 *     formatting variations).
 *   - Both bounds inclusive: `from <= firstAt <= to`. The previous
 *     `firstAt >= to` half-open upper excluded a session whose `firstAt`
 *     landed exactly on the drill point — `ChartCard`'s daily point-drill
 *     emits `from === to === dayStart`, so a half-open upper silently
 *     returned an empty sessions interval.
 *
 * `host` parity (review #13): pre-fix the route accepted `host` but never
 * projected or filtered it, so a non-matching host chip silently returned
 * every session while `/api/metrics` returned nothing. Post #P4-15
 * (review #19), `Session.host` is sourced from the real scan-root label
 * resolved at recompute time (`server/store/store.ts`'s `sessionRoot` +
 * `hostLabels`), and this route filters on that same value — Dashboard
 * callers can pass the chip value straight through to both
 * `/api/sessions` and `/api/metrics` without drift. Sessions whose root
 * is unlabeled fall back to the raw root path; sessions with no root at
 * all (rare) carry the literal sentinel `"unlabeled"` (see
 * `server/store/derive-session.ts`).
 */
function sessionMatchesFilters(session: Session, params: SessionListParams): boolean {
  if (params.from !== undefined) {
    const fromMs = Date.parse(params.from);
    if (Number.isFinite(fromMs) && Date.parse(session.firstAt) < fromMs) return false;
  }
  if (params.to !== undefined) {
    const toMs = Date.parse(params.to);
    if (Number.isFinite(toMs) && Date.parse(session.firstAt) > toMs) return false;
  }

  if (params.project !== undefined && !params.project.includes(session.project)) {
    return false;
  }
  if (params.branch !== undefined && !params.branch.includes(session.gitBranch)) {
    return false;
  }
  if (params.model !== undefined && !session.models.some((m) => (params.model ?? []).includes(m))) {
    return false;
  }
  if (params.host !== undefined && !params.host.includes(session.host)) {
    return false;
  }
  return true;
}

/** Numeric/date extraction for the supported summary sort keys. */
function sortValue(session: Session, key: SummarySortKey): number | string {
  switch (key) {
    case "lastAt":
      // ISO-8601 lexical sort matches chronological sort.
      return session.lastAt;
    case "costComputed":
      return session.costComputed;
    case "durationMs":
      return session.durationMs ?? 0;
    case "cacheSavingsComputed":
      return session.cacheSavingsComputed ?? 0;
    case "maxTurnCostComputed":
      return session.maxTurnCostComputed ?? 0;
    default: {
      // Review #18: the cast `av as number` below was correct only because
      // the union narrowed by exclusion; a future SortKey addition would
      // silently fall through. Throw to make the exhaustiveness load-bearing
      // rather than implicit.
      const unhandled: never = key;
      throw new Error(`unhandled sort key: ${unhandled}`);
    }
  }
}

/**
 * Deterministic sort. Primary direction follows `order`; the secondary
 * tie-break on `sessionId` (always ascending) is what makes
 * `limit=10&offset=0` and `limit=10&offset=10` non-overlapping for equal
 * primary values (test scenario "paginates deterministically").
 */
function compareSessions(
  a: Session,
  b: Session,
  key: SummarySortKey,
  direction: NonNullable<SessionListParams["order"]>,
): number {
  if (key === "lastAt") {
    // Sessions with no parsed calls yet carry lastAt === "" (derive-session.ts's
    // unset sentinel). "" is not a meaningful position in either chronological
    // direction, so it must always sort last regardless of `order` — otherwise
    // an in-progress session jumps to the top of the list under order=asc.
    const aUnset = a.lastAt === "";
    const bUnset = b.lastAt === "";
    if (aUnset !== bUnset) return aUnset ? 1 : -1;
  }
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  let cmp: number;
  if (typeof av === "string" && typeof bv === "string") {
    cmp = av.localeCompare(bv);
  } else {
    const an = av as number;
    const bn = bv as number;
    cmp = an < bn ? -1 : an > bn ? 1 : 0;
  }
  // Tie-break is always ascending on sessionId regardless of direction —
  // a stable anchor for pagination.
  return cmp !== 0 ? (direction === "asc" ? cmp : -cmp) : a.sessionId.localeCompare(b.sessionId);
}

/** OR-aggregate `TierFlags` across every session in the unfiltered file set. */
function aggregateGlobalCapture(sessions: Session[]): SessionListMeta["globalCapture"] {
  let hasCostSamples = false;
  let hasTurnBoundaries = false;
  let hasCostLog = false;
  for (const session of sessions) {
    if (session.tier.hasCostSamples) hasCostSamples = true;
    if (session.tier.hasTurnBoundaries) hasTurnBoundaries = true;
    if (session.tier.hasCostLog) hasCostLog = true;
  }
  // costBasis: "observed" the moment any session has C/B/L files; "computed"
  // otherwise. Matches the per-session tier's "computed today, observed when
  // #P4-13 wires premium files through" semantics.
  const costBasis: "computed" | "observed" = hasCostSamples ? "observed" : "computed";
  return { hasCostSamples, hasTurnBoundaries, hasCostLog, costBasis };
}

/**
 * Cost-capture setup guide readout (#P4-15, `SessionListMeta.captureSummary`).
 * Rides the same unfiltered-fleet pass as `aggregateGlobalCapture` — no
 * extra route or fetch (`GET /api/health` is #P4-14's job, not built yet).
 */
function computeCaptureSummary(sessions: Session[]): SessionListMeta["captureSummary"] {
  let capturingSessions = 0;
  let lastCapturedAt: string | null = null;
  for (const session of sessions) {
    if (!session.tier.hasCostSamples) continue;
    capturingSessions += 1;
    if (session.lastAt !== "" && (lastCapturedAt === null || session.lastAt > lastCapturedAt)) {
      lastCapturedAt = session.lastAt;
    }
  }
  return { capturingSessions, lastCapturedAt };
}

/**
 * Build the cumulative priced-turn trace for one session. Uses the injected
 * pricer so trace costs agree with the Store's `costComputed` accumulation;
 * falls back to 0 per turn when no pricer is wired (legacy `buildApp({ store })`
 * callers). Capped at `SESSIONS_MAX_TRACE_POINTS` per item — the rest are
 * dropped, not extrapolated, to keep the response bounded.
 *
 * (#P4-5, A4) Each point represents one *logical* prompt turn — sidechain
 * segments are folded under their parent prompt so the dashboard trace and
 * the Session Detail page observe the same one-based turn numbering.
 */
function buildTrace(store: Store, session: Session, pricer: Pricer | undefined): TracePoint[] {
  const turns = store.getTurns(session.sessionId);
  const logicalTurns = groupLogicalTurns(turns);
  const points: TracePoint[] = [];
  let cumulative = 0;
  const limit = Math.min(logicalTurns.length, SESSIONS_MAX_TRACE_POINTS);
  for (let i = 0; i < limit; i++) {
    const group = logicalTurns[i];
    if (!group) continue;
    let turnCost = 0;
    if (pricer) {
      turnCost = aggregateLogicalTurnCost(group, pricer);
    }
    cumulative += turnCost;
    points.push({ turnIndex: i, cost: cumulative, timestamp: group.startedAt ?? "" });
  }
  return points;
}

/** Project one Store Session into the wire `SessionListItem`. */
function projectItem(
  session: Session,
  trace: TracePoint[] | undefined,
  gateSummary: GateSummaryLite | null,
): SessionListItem {
  return {
    sessionId: session.sessionId,
    startedAt: session.firstAt,
    lastAt: session.lastAt,
    project: session.project,
    // Session.models is multi-valued; the wire item takes the first.
    // Dashboard consumers that need the full list should hit the future
    // session-detail endpoint (#P4-4), not widen this contract.
    model: session.models[0] ?? "",
    branch: session.gitBranch === "" ? undefined : session.gitBranch,
    // Real host (#P4-15, ARCH-settings-local-store.md A7) — resolved by the
    // Store from the session's scan root, no longer a documented gap.
    host: session.host,
    durationMs: session.durationMs ?? 0,
    turnCount: session.turnCount,
    costComputed: session.costComputed,
    cacheSavingsComputed: session.cacheSavingsComputed,
    maxTurnCostComputed: session.maxTurnCostComputed,
    contextPctEstimated: session.contextPctEstimated,
    // Gate summary fields (#P4-12) — populated only when the cache has a
    // summary, absent otherwise; the Dashboard gate-failure feed and
    // the Sessions gate column both rely on this wire shape.
    gateScore: gateSummary?.score,
    gateStatus: gateSummary?.status,
    trace,
  };
}

// ---------------------------------------------------------------------------
// Page projection helpers (#P4-4 / ARCH-sessions-page T2)
// ---------------------------------------------------------------------------

/** Numeric/date/string extraction for every supported page sort key. The
 * exhaustive switch throws on a future SortKey addition rather than silently
 * falling through (review #18 pattern from the summary projection). */
export function pageSortValue(session: Session, key: PageSortKey): number | string {
  switch (key) {
    case "lastAt":
      return session.lastAt;
    case "costComputed":
      return session.costComputed;
    case "costObserved":
      return session.costObserved ?? 0;
    case "durationMs":
      return session.durationMs ?? 0;
    case "totalTokens":
      return totalTokensForSession(session);
    case "turnCount":
      return session.turnCount;
    case "cacheHitPct":
      return session.cacheHitPct;
    case "cacheSavingsComputed":
      return session.cacheSavingsComputed ?? 0;
    case "maxTurnCostComputed":
      return session.maxTurnCostComputed ?? 0;
    case "gateScore":
      return session.gateScore ?? 0;
    case "branch":
      return session.gitBranch;
    case "version":
      return session.version;
    default: {
      const unhandled: never = key;
      throw new Error(`unhandled page sort key: ${unhandled}`);
    }
  }
}

export function comparePageSessions(
  a: Session,
  b: Session,
  key: PageSortKey,
  direction: NonNullable<SessionPageParams["order"]>,
): number {
  if (key === "lastAt") {
    // Same ""-sentinel handling as the summary sort (review #14).
    const aUnset = a.lastAt === "";
    const bUnset = b.lastAt === "";
    if (aUnset !== bUnset) return aUnset ? 1 : -1;
  }
  const av = pageSortValue(a, key);
  const bv = pageSortValue(b, key);
  let cmp: number;
  if (typeof av === "string" && typeof bv === "string") {
    cmp = av.localeCompare(bv);
  } else {
    const an = av as number;
    const bn = bv as number;
    cmp = an < bn ? -1 : an > bn ? 1 : 0;
  }
  // Tie-break: sessionId ascending always — pagination anchor.
  return cmp !== 0 ? (direction === "asc" ? cmp : -cmp) : a.sessionId.localeCompare(b.sessionId);
}

/** Translate `SessionPageParams` (flat) into the canonical
 * `SessionPopulationFilter` (range + criteria). Used by every page section
 * — table, timeline, compare — so the population is computed once and
 * reused (ARCH A2 single population). */
function pagePopulationFilter(params: SessionPageParams): SessionPopulationFilter | null {
  if (params.from === undefined || params.to === undefined) return null;
  return {
    range: { from: params.from, to: params.to },
    project: params.project,
    model: params.model,
    branch: params.branch,
    host: params.host,
    entrypoint: params.entrypoint,
    minCostComputed: params.minCostComputed,
    maxCostComputed: params.maxCostComputed,
    gateStatus: params.gateStatus,
    hasDrilldown: params.hasDrilldown,
    sessionId: params.sessionId,
  };
}

/** Strict page-row projection (ARCH `SessionPageItem`). Keeps every
 * transcript-tier field mandatory and surfaces optional premium / gate /
 * tag fields exactly when present (no fabrication). Exported so the
 * Sessions export route (`server/routes/export.ts`) can reuse the exact
 * same projection for CSV/JSON downloads — keeps on-screen and on-disk
 * row shapes in lock-step (review #19 merge with main). The `tags`
 * parameter is optional: export callers don't have per-session tag data
 * handy at the moment, while the on-screen page route threads it
 * through from `readLocalStore`.
 *
 * `gateSummary` carries the per-session Report Card summary (#P4-12);
 * absent summaries leave `gateStatus` unset (the established "no
 * fabrication" rule for reserved optional fields). The `gateScore`
 * pre-population from `session.gateScore` is overwritten by the summary
 * when available — the two sources are identical in the steady state,
 * but the summary is what keeps the per-row value in lock-step with the
 * Report Card on Session Detail. */
export function projectPageItem(
  session: Session,
  tags?: string[],
  gateSummary?: GateSummaryLite | null,
): SessionPageItem {
  return {
    sessionId: session.sessionId,
    startedAt: session.firstAt,
    lastAt: session.lastAt,
    project: session.project,
    models: session.models,
    branch: session.gitBranch === "" ? undefined : session.gitBranch,
    host: session.host,
    entrypoint: session.entrypoint,
    version: session.version,
    durationMs: session.durationMs ?? 0,
    turnCount: session.turnCount,
    totalTokens: totalTokensForSession(session),
    cacheHitPct: session.cacheHitPct,
    costComputed: session.costComputed,
    costObserved: session.costObserved,
    linesAdded: session.linesAdded,
    linesRemoved: session.linesRemoved,
    contextPctEstimated: session.contextPctEstimated,
    contextPctObserved: undefined,
    gateScore: gateSummary?.score ?? session.gateScore,
    // Session.gateStatus is not a field on `Session` (only Turn.gateStatus
    // is — gates.md §1 has session-scoped E1/E2 + turn-scoped V1/V2/P3/C3/K2).
    // The summary is the only source of a session-level status string today.
    gateStatus: gateSummary?.status,
    tags,
    hasDrilldown: session.turnCount > 0,
    tier: session.tier,
  };
}

/** Build the timeline projection (ARCH `SessionTimelineSet`) from the
 * matched (but not yet timeline-eligible) population. A session is
 * timeline-eligible iff both `startedAt` and `lastAt` are parseable; the
 * eligibility gap is disclosed via `excludedInvalidTime`. */
function buildTimelineSet(matched: Session[]): SessionTimelineSet {
  let excludedInvalidTime = 0;
  const eligible: Session[] = [];
  for (const session of matched) {
    const startMs = Date.parse(session.firstAt);
    const endMs = Date.parse(session.lastAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      excludedInvalidTime++;
      continue;
    }
    eligible.push(session);
  }
  const items = eligible.map<SessionTimelineItem>((s) => ({
    sessionId: s.sessionId,
    project: s.project,
    startedAt: s.firstAt,
    lastAt: s.lastAt,
    costComputed: s.costComputed,
  }));
  const sampled = items.length > SESSIONS_TIMELINE_CAP;
  const visible = sampled ? sampleTimelineDeterministically(items) : items;
  return {
    items: visible,
    matched: matched.length,
    eligible: eligible.length,
    returned: visible.length,
    sampled,
    excludedInvalidTime,
  };
}

/** Outlier-preserving deterministic timeline sampling (ARCH A5/R11).
 * Same head/tail + evenly-spaced-middle strategy as the scatter sampler
 * (server/metrics/scatter.ts), keyed on timeline duration so the longest
 * and shortest sessions always appear in the Gantt view. */
function sampleTimelineDeterministically(items: SessionTimelineItem[]): SessionTimelineItem[] {
  if (items.length <= SESSIONS_TIMELINE_CAP) return items;
  const sorted = [...items].sort((a, b) => {
    const aMs = Date.parse(a.lastAt) - Date.parse(a.startedAt);
    const bMs = Date.parse(b.lastAt) - Date.parse(b.startedAt);
    const diff = bMs - aMs;
    if (diff !== 0) return diff;
    return a.sessionId.localeCompare(b.sessionId);
  });
  const tail = Math.max(1, Math.floor(SESSIONS_TIMELINE_CAP * 0.02));
  const head = sorted.slice(0, tail);
  const tailSlice = sorted.slice(-tail);
  const middle = sorted.slice(tail, sorted.length - tail);
  const middleCap = SESSIONS_TIMELINE_CAP - head.length - tailSlice.length;
  if (middleCap <= 0) return [...head, ...tailSlice];
  const step = Math.max(1, Math.floor(middle.length / middleCap));
  const middleSample: SessionTimelineItem[] = [];
  for (let i = 0; i < middle.length && middleSample.length < middleCap; i += step) {
    const point = middle[i];
    if (point) middleSample.push(point);
  }
  return [...head, ...middleSample, ...tailSlice];
}

function computeMatchedExtent(matched: Session[]): SessionListMeta["matchedExtent"] {
  // Numeric comparison (review #14 / CQ7): raw string comparison orders
  // today's ISO timestamps correctly but is fragile against sub-second
  // precision or offset variations. Use `Date.parse` epoch-ms.
  let earliest: { firstAt: string; ms: number } | null = null;
  let latest: { lastAt: string; ms: number } | null = null;
  for (const s of matched) {
    const firstMs = Date.parse(s.firstAt);
    if (Number.isFinite(firstMs)) {
      if (!earliest || firstMs < earliest.ms) earliest = { firstAt: s.firstAt, ms: firstMs };
    }
    const lastMs = Date.parse(s.lastAt);
    if (Number.isFinite(lastMs)) {
      if (!latest || lastMs > latest.ms) latest = { lastAt: s.lastAt, ms: lastMs };
    }
  }
  if (!earliest || !latest) return null;
  return { from: earliest.firstAt, to: latest.lastAt };
}

export function registerSessionsRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterSessionsRouteOptions = {},
): void {
  const pricer = options.pricer;

  app.get("/api/sessions", async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    // Projection dispatcher: `view=page` goes through the page parser and
    // projection; everything else stays on the existing summary path. The
    // include flag is a projection modifier, not a separate route — the
    // page parser owns `include=timeline`, the summary parser owns
    // `include=trace`, and cross-projection combinations (e.g.
    // `view=page&include=trace`) 400 explicitly to keep the contract
    // unambiguous.
    const isPage = query.view === "page";
    if (isPage && query.include === "trace") {
      reply.code(400);
      return { error: 'view=page does not support include="trace"' };
    }
    if (!isPage && query.include === "timeline") {
      reply.code(400);
      return { error: 'include="timeline" requires view="page"' };
    }

    if (isPage) {
      const parsed = parseSessionsPageQuery(query);
      if (typeof parsed === "string") {
        reply.code(400);
        return { error: parsed };
      }
      return handlePageRequest(store, parsed, reply, options.localStorePath, options.gatesCache);
    }

    const parsed = parseSessionsQuery(query);
    if (typeof parsed === "string") {
      reply.code(400);
      return { error: parsed };
    }
    return handleSummaryRequest(store, parsed, reply, pricer, options.gatesCache);
  });

  app.put<{ Params: { id: string } }>(
    "/api/sessions/:id/tags",
    async (request, reply): Promise<{ tags: string[] } | { error: string }> => {
      const sessionId = request.params.id;
      // getSessionSnapshot forces a synchronous recompute (matches
      // session-detail.ts's existence check) — getSession alone would 404 a
      // session whose debounce window hasn't flushed yet even though its
      // records are already in the Store.
      if (!store.getSessionSnapshot(sessionId)) {
        reply.code(404);
        return { error: "session not found" };
      }
      const tags = extractField(request.body, "tags");
      if (!isValidTagList(tags)) {
        reply.code(400);
        return { error: "tags must be an array of non-empty strings" };
      }
      // Write failures bubble to app.ts's top-level setErrorHandler
      // (review #19). Validation/404 stay local because they need a
      // typed 400/404, not the generic 500 envelope.
      await mutateLocalStore(
        (current) => ({ tags: { ...current.tags, [sessionId]: tags } }),
        options.localStorePath,
      );
      return { tags };
    },
  );
}

async function handleSummaryRequest(
  store: Store,
  parsed: SessionListParams,
  reply: import("fastify").FastifyReply,
  pricer: Pricer | undefined,
  gatesCache: GatesCache | undefined,
): Promise<SessionListResponse | { error: string }> {
  const sort = parsed.sort ?? "lastAt";
  const order = parsed.order ?? "desc";
  const offset = parsed.offset ?? 0;
  // Silently cap `limit` at SESSIONS_MAX_LIMIT — the route never 400s on an
  // oversized page (the test scenario "caps limit at the documented maximum"
  // expects the response to use the cap, not reject the request). The cap
  // is surfaced via the `x-sessions-limit-capped` header so callers can
  // detect it without parsing the URL.
  const requestedLimit = parsed.limit ?? SESSIONS_DEFAULT_LIMIT;
  const limitCapped = requestedLimit > SESSIONS_MAX_LIMIT;
  const effectiveLimit = limitCapped ? SESSIONS_MAX_LIMIT : requestedLimit;

  if (parsed.include === "trace" && effectiveLimit > SESSIONS_TRACE_MAX_LIMIT) {
    reply.code(400);
    return { error: `include=trace requires limit <= ${SESSIONS_TRACE_MAX_LIMIT}` };
  }
  if (limitCapped) {
    reply.header("x-sessions-limit-capped", String(SESSIONS_MAX_LIMIT));
  }

  // globalCapture is filter-INDEPENDENT (section-level lock): the metadata
  // reflects the unfiltered file set, not the page the caller is
  // currently viewing. Read `store.listSessions()` once here, before any
  // filters apply, and aggregate across the full set.
  const allSessions = store.listSessions();
  const globalCapture = aggregateGlobalCapture(allSessions);

  const matched = allSessions.filter((session) => sessionMatchesFilters(session, parsed));
  const total = matched.length;

  matched.sort((a, b) => compareSessions(a, b, sort, order));

  const matchedExtent = computeMatchedExtent(matched);

  const page = matched.slice(offset, offset + effectiveLimit);

  // Single batch gate lookup for the page (#P4-12). The cache
  // single-flights per id, so concurrent evaluation is bounded; a cold
  // cache still pays O(N) engine evaluations on first load, exactly the
  // case the Open Question OQ1 in the ARCH flags as the next-step
  // optimization (lazy + memoized is the right MVP shape).
  const gateSummariesById = gatesCache
    ? await gatesCache.getSummariesBatch(page.map((s) => s.sessionId))
    : new Map<string, GateSummaryLite>();

  const items: SessionListItem[] = page.map((session) => {
    const trace = parsed.include === "trace" ? buildTrace(store, session, pricer) : undefined;
    const gateSummary = gateSummariesById.get(session.sessionId) ?? null;
    return projectItem(session, trace, gateSummary);
  });

  return {
    items,
    total,
    meta: {
      matchedExtent,
      globalCapture,
      captureSummary: computeCaptureSummary(allSessions),
    },
  };
}

async function handlePageRequest(
  store: Store,
  parsed: SessionPageParams,
  reply: import("fastify").FastifyReply,
  localStorePath: string | undefined,
  gatesCache: GatesCache | undefined,
): Promise<SessionPageResponse> {
  const sort = parsed.sort ?? "lastAt";
  const order = parsed.order ?? "desc";
  const offset = parsed.offset ?? 0;
  const requestedLimit = parsed.limit ?? SESSIONS_DEFAULT_LIMIT;
  const limitCapped = requestedLimit > SESSIONS_MAX_LIMIT;
  const effectiveLimit = limitCapped ? SESSIONS_MAX_LIMIT : requestedLimit;
  if (limitCapped) {
    reply.header("x-sessions-limit-capped", String(SESSIONS_MAX_LIMIT));
  }

  // Section-level lock: globalCapture is filter-INDEPENDENT, same as the
  // summary projection. Read the unfiltered file set once before any
  // population filter applies.
  const allSessions = store.listSessions();
  const globalCapture = aggregateGlobalCapture(allSessions);

  // The canonical population (ARCH A2 single population). When the page
  // request lacks a range (e.g. compare-only), the population is the
  // sessionId allowlist intersected with the all-sessions set; every other
  // section is unreachable in that case and returns empty.
  const filter = pagePopulationFilter(parsed);
  const matched: Session[] = filter
    ? applyRange(filter, allSessions).matched
    : parsed.sessionId !== undefined
      ? allSessions.filter((s) => parsed.sessionId?.includes(s.sessionId) ?? false)
      : [];

  const total = matched.length;

  const sorted = [...matched].sort((a, b) => comparePageSessions(a, b, sort, order));

  const matchedExtent = computeMatchedExtent(matched);

  const { tags: tagsBySessionId } = await readLocalStore(localStorePath);

  // Page handler is already async (it awaits readLocalStore), so we can
  // await the gate batch lookup too — page rows surface gate data
  // synchronously populated for every row.
  const visiblePage = sorted.slice(offset, offset + effectiveLimit);
  const gateSummariesById = gatesCache
    ? await gatesCache.getSummariesBatch(visiblePage.map((s) => s.sessionId))
    : new Map();

  const pageItems = visiblePage.map((session) => {
    const summary = gateSummariesById.get(session.sessionId);
    return projectPageItem(
      session,
      tagsBySessionId[session.sessionId],
      summary ? { score: summary.score, status: summary.status } : null,
    );
  });

  const response: SessionPageResponse = {
    items: pageItems,
    total,
    meta: {
      matched: total,
      matchedExtent,
      globalCapture,
      captureSummary: computeCaptureSummary(allSessions),
    },
  };

  if (parsed.include === "timeline") {
    response.timeline = buildTimelineSet(matched);
  }

  return response;
}
