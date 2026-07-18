import type {
  SessionListItem,
  SessionListMeta,
  SessionListParams,
  SessionListResponse,
  SessionPageItem,
  SessionPageParams,
  SessionPageResponse,
  SessionTimelineItem,
  SessionTimelineSet,
  TracePoint,
} from "../../../shared/sessions-contract.js";

// ---------------------------------------------------------------------------
// Typed errors — shared shape across compact + page wrappers
// ---------------------------------------------------------------------------

/**
 * Thrown by `listSessions` and `listSessionsPage` on non-2xx responses.
 * `status` is the raw HTTP code (lets UI distinguish 400 validation from
 * 5xx outages); `validation` is the Fastify validator's structured message
 * (`{ error: "..." }`) when one is present, else `null`. Surfacing the
 * validator's text directly to `isError` boundaries is what lets a user
 * see "sort must be one of ..." instead of a generic Error string.
 */
export class SessionsApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "SessionsApiError";
    this.status = status;
    this.validation = validation;
  }
}

/**
 * Thrown when a 2xx response fails the response-shape guard. Distinct from
 * `SessionsApiError` so callers (TanStack Query) can separate "server
 * rejected our request" from "server returned something we can't render".
 * Review #15 / TS1: pre-fix the wrapper asserted `body as SessionListResponse`
 * directly from `unknown`, so five Dashboard consumers dereferencing
 * `items[].meta.globalCapture` would crash on a malformed or version-skewed
 * payload. Now the type guard runs first and any structural failure surfaces
 * as a typed throw so the affected section renders its `isError` boundary
 * rather than throwing during render.
 */
export class SessionsResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionsResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Compact summary response guard
// ---------------------------------------------------------------------------

function isStringOrUndefined(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isFiniteOrUndefined(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isTracePoint(value: unknown): value is TracePoint {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { turnIndex?: unknown }).turnIndex === "number" &&
    Number.isFinite((value as { turnIndex?: unknown }).turnIndex) &&
    typeof (value as { cost?: unknown }).cost === "number" &&
    Number.isFinite((value as { cost?: unknown }).cost) &&
    typeof (value as { timestamp?: unknown }).timestamp === "string"
  );
}

function isSessionListItem(value: unknown): value is SessionListItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === "string" &&
    typeof v.startedAt === "string" &&
    typeof v.lastAt === "string" &&
    typeof v.project === "string" &&
    typeof v.model === "string" &&
    isStringOrUndefined(v.branch) &&
    isStringOrUndefined(v.host) &&
    typeof v.durationMs === "number" &&
    Number.isFinite(v.durationMs) &&
    typeof v.turnCount === "number" &&
    Number.isFinite(v.turnCount) &&
    typeof v.costComputed === "number" &&
    Number.isFinite(v.costComputed) &&
    isFiniteOrUndefined(v.cacheSavingsComputed) &&
    isFiniteOrUndefined(v.maxTurnCostComputed) &&
    isFiniteOrUndefined(v.contextPctEstimated) &&
    // Optional TracePoint field: either missing or an array of well-formed points.
    (v.trace === undefined || (Array.isArray(v.trace) && v.trace.every(isTracePoint)))
  );
}

function isSessionListMeta(value: unknown): value is SessionListMeta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.globalCapture !== "object" || v.globalCapture === null) {
    return false;
  }
  const capture = v.globalCapture as Record<string, unknown>;
  if (
    typeof capture.hasCostSamples !== "boolean" ||
    typeof capture.hasTurnBoundaries !== "boolean" ||
    typeof capture.hasCostLog !== "boolean" ||
    (capture.costBasis !== "computed" && capture.costBasis !== "observed")
  ) {
    return false;
  }
  // matchedExtent is {from, to} | null (shared/sessions-contract.ts) — both
  // bounds are required strings together, not independently optional.
  if (v.matchedExtent !== null) {
    if (typeof v.matchedExtent !== "object") return false;
    const e = v.matchedExtent as Record<string, unknown>;
    if (typeof e.from !== "string" || typeof e.to !== "string") return false;
  }
  return true;
}

function assertSessionListResponse(value: unknown): asserts value is SessionListResponse {
  if (typeof value !== "object" || value === null) {
    throw new SessionsResponseShapeError("expected object at the response root");
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items)) {
    throw new SessionsResponseShapeError("expected items to be an array");
  }
  if (typeof v.total !== "number" || !Number.isFinite(v.total)) {
    throw new SessionsResponseShapeError("expected total to be a finite number");
  }
  if (!isSessionListMeta(v.meta)) {
    throw new SessionsResponseShapeError("expected meta to match the contract shape");
  }
  for (const [i, item] of v.items.entries()) {
    if (!isSessionListItem(item)) {
      throw new SessionsResponseShapeError(`items[${i}] does not match the contract shape`);
    }
  }
}

// ---------------------------------------------------------------------------
// Page response guard (#P4-4)
// ---------------------------------------------------------------------------

function isTierFlags(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hasCostSamples === "boolean" &&
    typeof v.hasTurnBoundaries === "boolean" &&
    typeof v.hasCostLog === "boolean" &&
    (v.costBasis === "computed" || v.costBasis === "observed")
  );
}

function isSessionPageItem(value: unknown): value is SessionPageItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string") return false;
  if (typeof v.startedAt !== "string" || typeof v.lastAt !== "string") return false;
  if (typeof v.project !== "string") return false;
  if (!Array.isArray(v.models) || !v.models.every((m) => typeof m === "string")) return false;
  if (typeof v.host !== "string") return false;
  if (typeof v.entrypoint !== "string" || typeof v.version !== "string") return false;
  if (typeof v.durationMs !== "number" || !Number.isFinite(v.durationMs)) return false;
  if (typeof v.turnCount !== "number" || !Number.isFinite(v.turnCount)) return false;
  if (typeof v.totalTokens !== "number" || !Number.isFinite(v.totalTokens)) return false;
  if (typeof v.cacheHitPct !== "number" || !Number.isFinite(v.cacheHitPct)) return false;
  if (typeof v.costComputed !== "number" || !Number.isFinite(v.costComputed)) return false;
  if (
    v.costObserved !== undefined &&
    (typeof v.costObserved !== "number" || !Number.isFinite(v.costObserved))
  )
    return false;
  if (
    v.linesAdded !== undefined &&
    (typeof v.linesAdded !== "number" || !Number.isFinite(v.linesAdded))
  )
    return false;
  if (
    v.linesRemoved !== undefined &&
    (typeof v.linesRemoved !== "number" || !Number.isFinite(v.linesRemoved))
  )
    return false;
  if (
    v.contextPctEstimated !== undefined &&
    (typeof v.contextPctEstimated !== "number" || !Number.isFinite(v.contextPctEstimated))
  )
    return false;
  if (
    v.contextPctObserved !== undefined &&
    (typeof v.contextPctObserved !== "number" || !Number.isFinite(v.contextPctObserved))
  )
    return false;
  if (
    v.gateScore !== undefined &&
    (typeof v.gateScore !== "number" || !Number.isFinite(v.gateScore))
  )
    return false;
  if (v.gateStatus !== undefined && typeof v.gateStatus !== "string") return false;
  if (
    v.tags !== undefined &&
    !(Array.isArray(v.tags) && v.tags.every((t) => typeof t === "string"))
  )
    return false;
  if (typeof v.hasDrilldown !== "boolean") return false;
  if (!isTierFlags(v.tier)) return false;
  if (!isStringOrUndefined(v.branch)) return false;
  return true;
}

function isSessionTimelineItem(value: unknown): value is SessionTimelineItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === "string" &&
    typeof v.project === "string" &&
    typeof v.startedAt === "string" &&
    typeof v.lastAt === "string" &&
    typeof v.costComputed === "number" &&
    Number.isFinite(v.costComputed)
  );
}

function isSessionTimelineSet(value: unknown): value is SessionTimelineSet {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items)) return false;
  if (v.items.length > 500) return false; // ARCH A5/R11
  for (const [i, item] of v.items.entries()) {
    if (!isSessionTimelineItem(item)) {
      throw new SessionsResponseShapeError(
        `timeline.items[${i}] does not match the contract shape`,
      );
    }
  }
  return (
    typeof v.matched === "number" &&
    Number.isFinite(v.matched) &&
    typeof v.eligible === "number" &&
    Number.isFinite(v.eligible) &&
    typeof v.returned === "number" &&
    Number.isFinite(v.returned) &&
    typeof v.sampled === "boolean" &&
    typeof v.excludedInvalidTime === "number" &&
    Number.isFinite(v.excludedInvalidTime)
  );
}

function assertSessionPageResponse(value: unknown): asserts value is SessionPageResponse {
  if (typeof value !== "object" || value === null) {
    throw new SessionsResponseShapeError("expected object at the response root");
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.items)) {
    throw new SessionsResponseShapeError("expected items to be an array");
  }
  if (typeof v.total !== "number" || !Number.isFinite(v.total)) {
    throw new SessionsResponseShapeError("expected total to be a finite number");
  }
  if (typeof v.meta !== "object" || v.meta === null) {
    throw new SessionsResponseShapeError("expected meta to match the contract shape");
  }
  const meta = v.meta as Record<string, unknown>;
  if (typeof meta.matched !== "number" || !Number.isFinite(meta.matched)) {
    throw new SessionsResponseShapeError("expected meta.matched to be a finite number");
  }
  if (!isSessionListMeta(meta)) {
    throw new SessionsResponseShapeError("expected meta.matchedExtent/globalCapture to be valid");
  }
  for (const [i, item] of v.items.entries()) {
    if (!isSessionPageItem(item)) {
      throw new SessionsResponseShapeError(`items[${i}] does not match the contract shape`);
    }
  }
  if (v.timeline !== undefined && !isSessionTimelineSet(v.timeline)) {
    throw new SessionsResponseShapeError("expected timeline to match the contract shape");
  }
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/**
 * The single client caller of GET /api/sessions (server/routes/sessions.ts).
 * Mirrors `postMetrics` (client/src/api/metrics.ts): AbortSignal passthrough
 * for React Query's superseded-request cancellation, typed throw on non-2xx
 * so TanStack Query surfaces it via `isError`/`error`. Defaults `params` to
 * `{}` so callers passing no filters (the common case) skip the argument
 * without producing `undefined` in the URL.
 *
 * The wrapper normalizes its own params — empty strings and empty arrays
 * drop from the URL so callers don't trip the server validator's "empty
 * filter is indistinguishable from no filter" guard by passing a stray
 * `project: ""` through.
 */
export async function listSessions(
  params: SessionListParams = {},
  signal?: AbortSignal,
): Promise<SessionListResponse> {
  const url = `/api/sessions${buildQueryString(params)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const detail = validation ?? response.statusText;
    throw new SessionsApiError(
      response.status,
      validation,
      `GET /api/sessions failed (${response.status}): ${detail}`,
    );
  }

  const body: unknown = await response.json();
  assertSessionListResponse(body);
  return body;
}

/**
 * Page-projection wrapper for the Sessions page (#P4-4). Forces
 * `view=page` and serializes the wider page-only filters/sorts/timeline/
 * sessionId fields onto the same `/api/sessions` endpoint.
 *
 * The summary `listSessions` wrapper keeps its narrow contract untouched —
 * `listSessionsPage` is a strictly additive path so every Dashboard caller
 * remains on the existing surface (ARCH A1).
 */
export async function listSessionsPage(
  params: Omit<SessionPageParams, "view"> = {},
  signal?: AbortSignal,
): Promise<SessionPageResponse> {
  const url = `/api/sessions${buildPageQueryString(params)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const detail = validation ?? response.statusText;
    throw new SessionsApiError(
      response.status,
      validation,
      `GET /api/sessions failed (${response.status}): ${detail}`,
    );
  }

  const body: unknown = await response.json();
  assertSessionPageResponse(body);
  return body;
}

// ---------------------------------------------------------------------------
// URL encoding
// ---------------------------------------------------------------------------

/**
 * Serializes `SessionListParams` into a `?key=value&...` fragment (no
 * leading `?`). Empty strings, undefined, and empty arrays drop the key —
 * the server validator rejects an empty filter list ("empty after trim is
 * indistinguishable from 'no filter applied'"), so the wrapper silently
 * skips them to keep callers from tripping it inadvertently.
 *
 * Multi-valued filters (project, model, branch, host) are CSV-encoded —
 * matches the server's `parseSessionsQuery` which splits on commas. Empty
 * segments within the array are filtered before joining (e.g.
 * `["a", "", "b"]` becomes `project=a,b`, not `project=a,,b`).
 *
 * Insertion order is the wire's contract: it matches the order the spec
 * enumerates (sort, order, offset, limit, from, to, project, model,
 * branch, host, include) so the test scenario "sends allowed query fields
 * verbatim" produces a stable, expected URL.
 */
function buildQueryString(params: SessionListParams): string {
  const search = new URLSearchParams();

  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);

  for (const key of ["project", "model", "branch", "host"] as const) {
    const value = params[key];
    if (!value || value.length === 0) continue;
    // Trim + drop empties: matches `filters/state.ts`'s chip-handling
    // conventions so `["", "  "]` produces no key (a whitespace-only
    // value would otherwise round-trip to the server as garbage).
    const nonEmpty = value.map((v) => v.trim()).filter((v) => v.length > 0);
    if (nonEmpty.length > 0) search.set(key, nonEmpty.join(","));
  }

  if (params.include) search.set("include", params.include);

  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Page-projection URL builder (ARCH A1). Always emits `view=page` first so
 * the wire order is unambiguous, then fields in the documented order:
 * `view, sort, order, offset, limit, from, to, project, model, branch,
 * host, entrypoint, minCostComputed, maxCostComputed, hasDrilldown,
 * sessionId, include`. Boolean `hasDrilldown` serializes as the literal
 * strings `"true"` / `"false"` (URL semantics turn `+` into space, so a
 * raw boolean would have to be coerced server-side anyway).
 */
function buildPageQueryString(params: Omit<SessionPageParams, "view">): string {
  const search = new URLSearchParams();
  search.set("view", "page");

  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);

  for (const key of ["project", "model", "branch", "host", "entrypoint", "gateStatus"] as const) {
    const value = params[key];
    if (!value || value.length === 0) continue;
    const nonEmpty = value.map((v) => v.trim()).filter((v) => v.length > 0);
    if (nonEmpty.length > 0) search.set(key, nonEmpty.join(","));
  }

  if (params.minCostComputed !== undefined) {
    search.set("minCostComputed", String(params.minCostComputed));
  }
  if (params.maxCostComputed !== undefined) {
    search.set("maxCostComputed", String(params.maxCostComputed));
  }
  if (params.hasDrilldown !== undefined) {
    search.set("hasDrilldown", params.hasDrilldown ? "true" : "false");
  }
  if (params.sessionId !== undefined && params.sessionId.length > 0) {
    const nonEmpty = params.sessionId.map((v) => v.trim()).filter((v) => v.length > 0);
    if (nonEmpty.length > 0) search.set("sessionId", nonEmpty.join(","));
  }

  if (params.include) search.set("include", params.include);

  return `?${search.toString()}`;
}
