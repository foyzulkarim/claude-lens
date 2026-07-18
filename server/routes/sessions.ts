import type { FastifyInstance } from "fastify";
import type {
  SessionListItem,
  SessionListMeta,
  SessionListParams,
  SessionListResponse,
  TracePoint,
} from "../../shared/sessions-contract.js";
import type { Session } from "../../shared/types.js";
import type { PricingTable } from "../metrics/measures.js";
import type { Pricer } from "../store/derive-session.js";
import type { Store } from "../store/store.js";

// GET /api/sessions — general paginated sessions list (ARCH T6 / #P4-2).
// Patterned on routes/metrics.ts (Fastify plugin, manual validation that
// returns 400 with a typed error, no Fastify schema because we need CSV
// array splitting that the schema DSL can't express cleanly). READ-ONLY
// — never mutates Store. Project/sort/filter/page happens here, not in the
// Store, so the Store stays a pure columnar source.

export const SESSIONS_DEFAULT_LIMIT = 25;
export const SESSIONS_MAX_LIMIT = 100;
/** include=trace is only safe on small pages; cap it below the default limit cap. */
export const SESSIONS_TRACE_MAX_LIMIT = 25;
/** Per-item trace point cap — bounds the cumulative priced turn array. */
export const SESSIONS_MAX_TRACE_POINTS = 50;

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
}

const SORT_KEYS = new Set<NonNullable<SessionListParams["sort"]>>([
  "lastAt",
  "costComputed",
  "durationMs",
  "cacheSavingsComputed",
  "maxTurnCostComputed",
]);
const ORDER_KEYS = new Set<NonNullable<SessionListParams["order"]>>(["asc", "desc"]);

type SortKey = NonNullable<SessionListParams["sort"]>;

/**
 * Parses the Fastify query object into a typed `SessionListParams`. Returns
 * either the validated params or a human-readable error message — never
 * throws. Mirrors `parseMetricsQuery`'s shape so the route can return a 400
 * with `{ error }` in the same convention.
 */
export function parseSessionsQuery(raw: unknown): SessionListParams | string {
  if (raw === null || typeof raw !== "object") return "query must be an object";
  const q = raw as Record<string, unknown>;
  const params: SessionListParams = {};

  if (q.sort !== undefined) {
    if (typeof q.sort !== "string" || !SORT_KEYS.has(q.sort as SortKey)) {
      return "sort must be one of lastAt, costComputed, durationMs, cacheSavingsComputed, maxTurnCostComputed";
    }
    params.sort = q.sort as SortKey;
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
 * True iff the session matches the query filters. `from`/`to` use the
 * session-start convention (`session.firstAt`, matching how the metrics
 * engine buckets sessions in `scopeFor`), inclusive on BOTH bounds.
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
 * `host` parity (review #13): the metrics engine synthesizes a constant
 * `"default"` host for every scope (see `server/metrics/dimensions.ts`),
 * and the Dashboard callers pass the active `host` chip straight through
 * to both `/api/sessions` and `/api/metrics`. Pre-fix the route accepted
 * `host` but never projected or filtered it, so a non-matching host chip
 * silently returned every session while `/api/metrics` returned nothing.
 * Now `host` filters the same synthetic `"default"` the engine synthesizes,
 * so a chip value that includes `"default"` matches every session, and any
 * other chip value matches none (the engine and the route agree). When
 * per-host Session fields land, this becomes a real field lookup without
 * changing the contract.
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

/** Numeric/date extraction for the supported sort keys. */
function sortValue(session: Session, key: SortKey): number | string {
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
  key: SortKey,
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
 * Build the cumulative priced-turn trace for one session. Uses the injected
 * pricer so trace costs agree with the Store's `costComputed` accumulation;
 * falls back to 0 per turn when no pricer is wired (legacy `buildApp({ store })`
 * callers). Capped at `SESSIONS_MAX_TRACE_POINTS` per item — the rest are
 * dropped, not extrapolated, to keep the response bounded.
 */
function buildTrace(store: Store, session: Session, pricer: Pricer | undefined): TracePoint[] {
  const turns = store.getTurns(session.sessionId);
  const points: TracePoint[] = [];
  let cumulative = 0;
  const limit = Math.min(turns.length, SESSIONS_MAX_TRACE_POINTS);
  for (let i = 0; i < limit; i++) {
    const turn = turns[i];
    let turnCost = 0;
    if (pricer) {
      for (const call of turn.calls) {
        turnCost += pricer(call.usage, call.model);
      }
    }
    cumulative += turnCost;
    points.push({ turnIndex: i, cost: cumulative, timestamp: turn.startedAt });
  }
  return points;
}

/**
 * Project one Store Session into the wire `SessionListItem`. `host` is left
 * undefined (Session doesn't track host today — documented gap, not
 * fabricated).
 */
function projectItem(session: Session, trace: TracePoint[] | undefined): SessionListItem {
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
    durationMs: session.durationMs ?? 0,
    turnCount: session.turnCount,
    costComputed: session.costComputed,
    cacheSavingsComputed: session.cacheSavingsComputed,
    maxTurnCostComputed: session.maxTurnCostComputed,
    contextPctEstimated: session.contextPctEstimated,
    trace,
  };
}

export function registerSessionsRoute(
  app: FastifyInstance,
  store: Store,
  options: RegisterSessionsRouteOptions = {},
): void {
  const pricer = options.pricer;

  app.get("/api/sessions", async (request, reply) => {
    const parsed = parseSessionsQuery(request.query);
    if (typeof parsed === "string") {
      reply.code(400);
      return { error: parsed };
    }

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
      return {
        error: `include=trace requires limit <= ${SESSIONS_TRACE_MAX_LIMIT}`,
      };
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

    let matchedExtent: SessionListMeta["matchedExtent"] = null;
    // Sessions with no parsed calls yet (e.g. still being tailed live) carry
    // firstAt/lastAt === "" (derive-session.ts's unset sentinel). "" sorts
    // before every real ISO timestamp, so an in-progress session would
    // otherwise poison the extent to an empty string that fails downstream
    // /api/metrics validation (range.from/to must be parseable dates).
    const timestamped = matched.filter((s) => s.firstAt !== "" && s.lastAt !== "");
    if (timestamped.length > 0) {
      // Numeric comparison (review #14 / CQ7 convention, see sessionMatchesFilters
      // above): raw string comparison sorts today's ISO timestamps correctly but
      // is fragile against sub-second-precision or offset variations.
      let earliest = timestamped[0].firstAt;
      let earliestMs = Date.parse(earliest);
      let latest = timestamped[0].lastAt;
      let latestMs = Date.parse(latest);
      for (const s of timestamped) {
        const firstMs = Date.parse(s.firstAt);
        if (firstMs < earliestMs) {
          earliest = s.firstAt;
          earliestMs = firstMs;
        }
        const lastMs = Date.parse(s.lastAt);
        if (lastMs > latestMs) {
          latest = s.lastAt;
          latestMs = lastMs;
        }
      }
      matchedExtent = { from: earliest, to: latest };
    }

    const page = matched.slice(offset, offset + effectiveLimit);

    const items: SessionListItem[] = page.map((session) => {
      const trace = parsed.include === "trace" ? buildTrace(store, session, pricer) : undefined;
      return projectItem(session, trace);
    });

    const response: SessionListResponse = {
      items,
      total,
      meta: {
        matchedExtent,
        globalCapture,
      },
    };
    return response;
  });
}
