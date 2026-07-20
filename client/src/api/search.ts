import type {
  PromptSearchDoc,
  SearchIndexResponse,
} from "../../../shared/search-index-contract.js";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `getSearchIndex` on non-2xx responses. Mirrors the
 * `SessionsApiError` / `CacheLabApiError` split so the search panel's
 * `isError` boundary can surface the server's message verbatim rather
 * than a generic Error string.
 */
export class SearchIndexApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "SearchIndexApiError";
    this.status = status;
    this.validation = validation;
  }
}

/**
 * Thrown when a 2xx response fails the response-shape guard. Distinct
 * from `SearchIndexApiError` so callers (TanStack Query) can separate
 * "server rejected our request" from "server returned something we
 * can't render."
 */
export class SearchIndexResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchIndexResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Response shape guard
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPromptSearchDoc(value: unknown, index: number): value is PromptSearchDoc {
  if (!isRecord(value)) {
    throw new SearchIndexResponseShapeError(
      `prompts[${index}] is not an object (got ${value === null ? "null" : typeof value})`,
    );
  }
  // Required string fields
  for (const field of ["id", "sessionId", "promptId", "text", "timestamp"] as const) {
    if (typeof value[field] !== "string") {
      throw new SearchIndexResponseShapeError(
        `prompts[${index}].${field} must be a string (got ${typeof value[field]})`,
      );
    }
  }
  // Required number field
  if (typeof value.turnNumber !== "number" || !Number.isFinite(value.turnNumber)) {
    throw new SearchIndexResponseShapeError(
      `prompts[${index}].turnNumber must be a finite number (got ${typeof value.turnNumber})`,
    );
  }
  // Optional fields: must be string when present
  for (const field of ["cwd", "gitBranch"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new SearchIndexResponseShapeError(
        `prompts[${index}].${field} must be a string when present (got ${typeof value[field]})`,
      );
    }
  }
  return true;
}

/**
 * Asserts `value` is a well-formed `SearchIndexResponse`. The server
 * already type-checks at emit time, but a too-trusting client would
 * crash inside MiniSearch's `addAll` on a malformed/empty/v1 payload
 * from a future server — this guard turns that into a typed throw
 * the panel can render as a recoverable error state. Validates every
 * doc, not just the first, because `addAll` is all-or-nothing: one
 * malformed element aborts the whole index build with an unhandled
 * `MiniSearch: document does not have ID field "id"`.
 */
function assertSearchIndexResponse(value: unknown): asserts value is SearchIndexResponse {
  if (!isRecord(value)) {
    throw new SearchIndexResponseShapeError("expected object at the response root");
  }
  if (!Array.isArray(value.prompts)) {
    throw new SearchIndexResponseShapeError("missing required field 'prompts' (expected array)");
  }
  if (typeof value.version !== "number" || !Number.isFinite(value.version)) {
    throw new SearchIndexResponseShapeError(
      `missing required field 'version' (expected finite number, got ${typeof value.version})`,
    );
  }
  for (let i = 0; i < value.prompts.length; i++) {
    isPromptSearchDoc(value.prompts[i], i);
  }
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * The single client caller of GET /api/search-index
 * (server/routes/search.ts). Mirrors `postCacheLab` / `listSessions`:
 * AbortSignal passthrough for TanStack Query's superseded-request
 * cancellation, typed throw on non-2xx, response-shape guard on 2xx.
 *
 * Returns the raw `SearchIndexResponse` — the panel decides how to
 * build a MiniSearch index from it. Keeping the wire shape and the
 * index-construction decoupled lets the component stay testable
 * against fixture payloads without faking fetch.
 */
export async function getSearchIndex(signal?: AbortSignal): Promise<SearchIndexResponse> {
  const response = await fetch("/api/search-index", { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      cause?: unknown;
    } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const cause = body && typeof body.cause === "string" ? body.cause : null;
    // Compose: server's high-level error first, then the underlying cause
    // (set by the Fastify setErrorHandler wrapper) so the user sees the
    // real failure mode rather than "Internal Server Error" alone.
    const detail = [validation, cause].filter((s): s is string => s !== null).join(": ");
    throw new SearchIndexApiError(
      response.status,
      validation,
      `GET /api/search-index failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  const body: unknown = await response.json();
  assertSearchIndexResponse(body);
  return body;
}
