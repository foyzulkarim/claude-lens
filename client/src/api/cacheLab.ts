import type { CacheLabAnalysis, CacheLabQuery } from "../../../shared/cache-lab-contract.js";

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown by `postCacheLab` on non-2xx responses. Mirrors
 * `SessionsApiError` so Cache Lab panels surface the validator's message
 * (e.g. "range.from must be parseable date strings") verbatim rather than
 * a generic Error string.
 */
export class CacheLabApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "CacheLabApiError";
    this.status = status;
    this.validation = validation;
  }
}

/**
 * Thrown when a 2xx response fails the response-shape guard. Distinct
 * from `CacheLabApiError` so consumers (TanStack Query) can separate
 * "server rejected our request" from "server returned something we
 * can't render".
 */
export class CacheLabResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheLabResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Response shape guard
// ---------------------------------------------------------------------------

const TRIMMED_KEYS = [
  "economics",
  "attribution",
  "ttlMix",
  "baseline",
  "invalidationCost",
  "gallery",
  "contextGrowth",
] as const;

function assertCacheLabAnalysis(value: unknown): asserts value is CacheLabAnalysis {
  if (typeof value !== "object" || value === null) {
    throw new CacheLabResponseShapeError("expected object at the response root");
  }
  const v = value as Record<string, unknown>;
  for (const key of TRIMMED_KEYS) {
    if (!(key in v)) {
      throw new CacheLabResponseShapeError(`missing required field '${key}'`);
    }
  }
  // Deliberately validate only the stable response boundary — the server already types-checked and
  // re-validates on every request, and a too-strict client guard would
  // break the page every time a new optional field lands. The point
  // here is just to ensure the response root is an object with the
  // seven top-level sections the page expects.
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * The single client caller of POST /api/cache-lab (server/routes/cache-lab.ts).
 * Mirrors `postMetrics`/`listSessions`: AbortSignal passthrough for
 * TanStack Query's superseded-request cancellation, typed throw on
 * non-2xx, response-shape guard on 2xx. Section-owned callers (T6/T7)
 * consume the analysis without re-validating the body shape.
 */
export async function postCacheLab(
  query: CacheLabQuery,
  signal?: AbortSignal,
): Promise<CacheLabAnalysis> {
  const response = await fetch("/api/cache-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const detail = validation ?? response.statusText;
    throw new CacheLabApiError(
      response.status,
      validation,
      `POST /api/cache-lab failed (${response.status}): ${detail}`,
    );
  }

  const body: unknown = await response.json();
  assertCacheLabAnalysis(body);
  return body;
}
