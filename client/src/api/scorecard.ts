import type { BiggestLeverView, SessionScorecardView } from "../../../shared/scorecard-contract.js";

/**
 * Client data layer for the two scorecard routes (ARCH-124-cache-scorecard.md
 * T7). Mirrors `client/src/api/gates.ts`'s conventions: a typed error for
 * non-2xx responses, a permissive structural response guard, and an
 * `AbortSignal` passthrough for TanStack Query cancellation. This module is
 * render-free — it never computes cause, grade, or dollars (Module
 * Boundaries): the server's discriminated `state` field and `kind` are
 * rendered directly.
 */
export class ScorecardApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "ScorecardApiError";
    this.status = status;
    this.validation = validation;
  }
}

const SESSION_SCORECARD_STATES = new Set([
  "graded",
  "too-short",
  "no-main-thread-calls",
  "no-scoreable-creation",
]);

const BIGGEST_LEVER_STATES = new Set(["event", "healthy", "no-cache-activity"]);

/**
 * Structural-shape guard for `SessionScorecardView`. Every discriminated
 * state shares `core`/`events`/`thresholdsUsed`/`evaluatedAt` (the grade
 * fields vary per state, per the contract) — this pins the common shape and
 * the `state` literal so a wire-shape drop crashes loudly instead of
 * silently rendering `undefined`.
 */
function isSessionScorecardView(value: unknown): value is SessionScorecardView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === "string" &&
    SESSION_SCORECARD_STATES.has(v.state) &&
    typeof v.core === "object" &&
    v.core !== null &&
    Array.isArray(v.events) &&
    typeof v.thresholdsUsed === "object" &&
    v.thresholdsUsed !== null &&
    typeof v.evaluatedAt === "string"
  );
}

function isBiggestLeverView(value: unknown): value is BiggestLeverView {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === "string" &&
    BIGGEST_LEVER_STATES.has(v.state) &&
    typeof v.evaluatedAt === "string"
  );
}

async function readErrorMessage(response: Response): Promise<string | null> {
  // A blanket `.catch(() => null)` would also swallow a genuine AbortError —
  // fetch ties the passed `signal` to the body-stream read, not just header
  // resolution, so an in-flight abort (unmount, param change) can reject
  // this exact `.json()` call. TanStack Query relies on recognizing
  // AbortError to silently discard a cancelled queryFn; re-throw it here so
  // it propagates like it already does on the 2xx path (#124 review finding
  // #25), instead of surfacing as a normal ScorecardApiError.
  const body = (await response.json().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  })) as { error?: unknown } | null;
  return body && typeof body.error === "string" ? body.error : null;
}

/**
 * GET /api/sessions/:id/scorecard — the R6 Session Detail section payload.
 * 404 (unknown session) and 500 surface as `ScorecardApiError`; a 2xx body
 * that fails the shape guard also throws it, distinct status `0`.
 */
export async function getSessionScorecard(
  id: string,
  signal?: AbortSignal,
): Promise<SessionScorecardView> {
  const url = `/api/sessions/${encodeURIComponent(id)}/scorecard`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const validation = await readErrorMessage(response);
    const detail = validation ?? response.statusText;
    throw new ScorecardApiError(
      response.status,
      validation,
      `GET ${url} failed (${response.status}): ${detail}`,
    );
  }

  const body: unknown = await response.json();
  if (!isSessionScorecardView(body)) {
    throw new ScorecardApiError(
      0,
      null,
      `GET ${url} returned a response that does not match the SessionScorecardView shape`,
    );
  }
  return body;
}

export interface BiggestLeverParams {
  from: string;
  to: string;
  project?: string[];
  model?: string[];
  branch?: string[];
  host?: string[];
}

/**
 * CSV-encodes the multi-valued filters, matching `sessions.ts`'s
 * `buildPageQueryString` convention (trim + drop empties, comma-join).
 */
function buildBiggestLeverQueryString(params: BiggestLeverParams): string {
  const search = new URLSearchParams();
  search.set("from", params.from);
  search.set("to", params.to);

  for (const key of ["project", "model", "branch", "host"] as const) {
    const value = params[key];
    if (!value || value.length === 0) continue;
    const nonEmpty = value.map((v) => v.trim()).filter((v) => v.length > 0);
    if (nonEmpty.length > 0) search.set(key, nonEmpty.join(","));
  }

  return `?${search.toString()}`;
}

/**
 * GET /api/dashboard/biggest-lever — the R7/R8 Dashboard card payload.
 * 400 (malformed/reversed range) and 500 surface as `ScorecardApiError`.
 */
export async function getBiggestLever(
  params: BiggestLeverParams,
  signal?: AbortSignal,
): Promise<BiggestLeverView> {
  const url = `/api/dashboard/biggest-lever${buildBiggestLeverQueryString(params)}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const validation = await readErrorMessage(response);
    const detail = validation ?? response.statusText;
    throw new ScorecardApiError(
      response.status,
      validation,
      `GET ${url} failed (${response.status}): ${detail}`,
    );
  }

  const body: unknown = await response.json();
  if (!isBiggestLeverView(body)) {
    throw new ScorecardApiError(
      0,
      null,
      `GET ${url} returned a response that does not match the BiggestLeverView shape`,
    );
  }
  return body;
}
