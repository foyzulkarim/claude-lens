import type {
  MetricsQuery,
  ScatterMeasure,
  ScatterMetricsQuery,
  ScatterMetricsResult,
  ScatterPoint,
  ScatterPopulationMeta,
  ScatterRegression,
  Series,
} from "../../../shared/metrics-contract.js";

// ---------------------------------------------------------------------------
// Aggregate metrics wrapper — preserves the existing return type
// ---------------------------------------------------------------------------

/**
 * The one caller of POST /api/metrics (server/routes/metrics.ts). Throws on
 * non-2xx so TanStack Query surfaces it via isError/error. Accepts the
 * AbortSignal TanStack Query passes to every queryFn so a stale in-flight
 * request (superseded by a rapid control-toggle changing the query key) is
 * cancelled instead of finishing unread.
 *
 * The aggregate return type stays `Series[]` — the scatter mode returns
 * a different shape (`ScatterMetricsResult`) and is dispatched through a
 * sibling wrapper (`postScatterMetrics` below) rather than widening this
 * one's return union.
 */
export async function postMetrics(query: MetricsQuery, signal?: AbortSignal): Promise<Series[]> {
  const response = await fetch("/api/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body && typeof body.error === "string" ? body.error : response.statusText;
    throw new Error(`POST /api/metrics failed (${response.status}): ${message}`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("POST /api/metrics returned a non-array response");
  }
  return body as Series[];
}

// ---------------------------------------------------------------------------
// Scatter wrapper — separate response guard, same fetch + abort contract
// ---------------------------------------------------------------------------

/** Thrown by `postScatterMetrics` on non-2xx responses. Mirrors
 * `SessionsApiError` so the Scatter card's section-level error boundary
 * can render the same actionable message. Distinct from the plain Error
 * thrown by `postMetrics` so a 400 with `error: "xMeasure must be …"`
 * surfaces verbatim (ARCH A4 / A12). */
export class MetricsApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "MetricsApiError";
    this.status = status;
    this.validation = validation;
  }
}

/** Thrown when a 2xx scatter response fails the response-shape guard.
 * Separate from `MetricsApiError` so callers (TanStack Query) can
 * distinguish "server rejected our request" from "server returned
 * something we can't render" — same split as `SessionsApiError` vs
 * `SessionsResponseShapeError`. */
export class ScatterResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScatterResponseShapeError";
  }
}

function isScatterMeasure(value: unknown): value is ScatterMeasure {
  return typeof value === "string" && value.length > 0;
}

function isFiniteOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isScatterPoint(value: unknown): value is ScatterPoint {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== "string") return false;
  if (!isFiniteOrNull(v.x)) return false;
  if (!isFiniteOrNull(v.y)) return false;
  if (v.size !== undefined && !isFiniteOrNull(v.size)) return false;
  return true;
}

function isScatterRegression(value: unknown): value is ScatterRegression {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.slope === "number" &&
    Number.isFinite(v.slope) &&
    typeof v.intercept === "number" &&
    Number.isFinite(v.intercept) &&
    typeof v.rSquared === "number" &&
    Number.isFinite(v.rSquared)
  );
}

function isScatterPopulationMeta(value: unknown): value is ScatterPopulationMeta {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.matched === "number" &&
    Number.isFinite(v.matched) &&
    typeof v.eligible === "number" &&
    Number.isFinite(v.eligible) &&
    typeof v.returned === "number" &&
    Number.isFinite(v.returned) &&
    typeof v.excludedMissingMeasures === "number" &&
    Number.isFinite(v.excludedMissingMeasures) &&
    typeof v.sampled === "boolean"
  );
}

function assertScatterResponse(value: unknown): asserts value is ScatterMetricsResult {
  if (typeof value !== "object" || value === null) {
    throw new ScatterResponseShapeError("expected object at the response root");
  }
  const v = value as Record<string, unknown>;
  if (v.mode !== "scatter") {
    throw new ScatterResponseShapeError('expected response mode to be "scatter"');
  }
  if (v.entity !== "session") {
    throw new ScatterResponseShapeError('expected response entity to be "session"');
  }
  if (!isScatterMeasure(v.xMeasure) || !isScatterMeasure(v.yMeasure)) {
    throw new ScatterResponseShapeError("expected xMeasure/yMeasure to be non-empty strings");
  }
  if (v.sizeMeasure !== undefined && !isScatterMeasure(v.sizeMeasure)) {
    throw new ScatterResponseShapeError(
      "expected sizeMeasure to be a non-empty string when present",
    );
  }
  if (!Array.isArray(v.points)) {
    throw new ScatterResponseShapeError("expected points to be an array");
  }
  if (v.points.length > 500) {
    // ARCH A5/R11: the visible-point cap is part of the contract.
    throw new ScatterResponseShapeError("expected points.length to be at most 500");
  }
  for (const [i, point] of v.points.entries()) {
    if (!isScatterPoint(point)) {
      throw new ScatterResponseShapeError(`points[${i}] does not match the contract shape`);
    }
  }
  if (v.regression !== null && !isScatterRegression(v.regression)) {
    throw new ScatterResponseShapeError(
      "expected regression to be null or a valid regression object",
    );
  }
  if (!isScatterPopulationMeta(v.population)) {
    throw new ScatterResponseShapeError("expected population to match the contract shape");
  }
}

/**
 * Scatter-specific POST /api/metrics wrapper. Same AbortSignal + non-2xx
 * + 2xx-shape-guard conventions as `postMetrics` and `listSessionsPage`
 * — wraps non-2xx as `MetricsApiError` (status + Fastify validator
 * message) and any 2xx-shape failure as `ScatterResponseShapeError`.
 */
export async function postScatterMetrics(
  query: ScatterMetricsQuery,
  signal?: AbortSignal,
): Promise<ScatterMetricsResult> {
  const response = await fetch("/api/metrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const detail = validation ?? response.statusText;
    throw new MetricsApiError(
      response.status,
      validation,
      `POST /api/metrics failed (${response.status}): ${detail}`,
    );
  }

  const body: unknown = await response.json();
  assertScatterResponse(body);
  return body;
}
