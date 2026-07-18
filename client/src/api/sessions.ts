import type { SessionListParams, SessionListResponse } from "../../../shared/sessions-contract.js";

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown by `listSessions` on non-2xx responses. `status` is the raw HTTP
 * code (lets UI distinguish 400 validation from 5xx outages); `validation`
 * is the Fastify validator's structured message (`{ error: "..." }`) when
 * one is present, else `null`. Surfacing the validator's text directly to
 * `isError` boundaries is what lets a user see "sort must be one of ..."
 * instead of a generic Error string.
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

// ---------------------------------------------------------------------------
// Wrapper
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
  return body as SessionListResponse;
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
