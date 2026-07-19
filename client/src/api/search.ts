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

/**
 * Asserts `value` is a well-formed `SearchIndexResponse`. The server
 * already type-checks at emit time, but a too-trusting client would
 * crash inside MiniSearch's `addAll` on a malformed/empty/v1 payload
 * from a future server — this guard turns that into a typed throw
 * the panel can render as a recoverable error state.
 */
function assertSearchIndexResponse(value: unknown): asserts value is SearchIndexResponse {
  if (typeof value !== "object" || value === null) {
    throw new SearchIndexResponseShapeError("expected object at the response root");
  }
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.prompts)) {
    throw new SearchIndexResponseShapeError("missing required field 'prompts' (expected array)");
  }
  if (typeof v.version !== "number") {
    throw new SearchIndexResponseShapeError("missing required field 'version' (expected number)");
  }
  // Spot-check the first doc so we catch "server returned [{...wrong shape}]"
  // before MiniSearch's addAll throws. We don't recursively validate — that
  // belongs at the wire boundary, not the client.
  if (v.prompts.length > 0) {
    const first = v.prompts[0] as Partial<PromptSearchDoc>;
    if (
      typeof first.id !== "string" ||
      typeof first.sessionId !== "string" ||
      typeof first.promptId !== "string" ||
      typeof first.turnNumber !== "number" ||
      typeof first.text !== "string" ||
      typeof first.timestamp !== "string"
    ) {
      throw new SearchIndexResponseShapeError(
        "first prompt doc is missing required fields (id/sessionId/promptId/turnNumber/text/timestamp)",
      );
    }
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
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const detail = validation ?? response.statusText;
    throw new SearchIndexApiError(
      response.status,
      validation,
      `GET /api/search-index failed (${response.status}): ${detail}`,
    );
  }
  const body: unknown = await response.json();
  assertSearchIndexResponse(body);
  return body;
}
