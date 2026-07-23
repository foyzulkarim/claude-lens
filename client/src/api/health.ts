import type {
  CaptureGaps,
  DedupStats,
  HealthSnapshot,
  ParseErrorSummary,
  PricingCoverage,
  ReconciliationRollup,
  ScanCoverage,
  SidecarCoverage,
} from "../../../shared/health-contract.js";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `fetchHealth` on non-2xx responses. Mirrors
 * `SearchIndexApiError` so the page's `isError` boundary can surface
 * the server's message verbatim rather than a generic Error string.
 */
export class HealthApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "HealthApiError";
    this.status = status;
    this.validation = validation;
  }
}

/**
 * Thrown when a 2xx response fails the response-shape guard
 * (review TS-3). Distinct from `HealthApiError` so callers (TanStack
 * Query) can separate "server rejected our request" from "server
 * returned something we can't render." Mirrors the search-index pattern
 * in `api/search.ts`.
 */
export class HealthResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthResponseShapeError";
  }
}

// ---------------------------------------------------------------------------
// Response shape guard
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

/** Asserts `value` is a structurally valid `HealthSnapshot`. The server
 *  already type-checks at emit time, but a too-trusting client would
 *  silently render `undefined` for missing nested fields and produce
 *  cryptic "Cannot read property 'length' of undefined" errors deep
 *  inside the panels. This guard turns that into a typed throw the
 *  page renders as a recoverable error state.
 *
 *  Validates every required top-level field + the critical nested
 *  primitives the panels read on first paint, but does NOT exhaustively
 *  check every leaf — the panels themselves handle missing optional
 *  fields defensively (empty arrays / zero counts).
 */
function assertHealthSnapshot(value: unknown): asserts value is HealthSnapshot {
  if (!isRecord(value)) {
    throw new HealthResponseShapeError("expected object at the response root");
  }

  // Top-level scalar fields
  for (const field of ["totalMalformedLines", "observedFileCount", "observedSince"] as const) {
    if (!isFiniteNumber(value[field])) {
      throw new HealthResponseShapeError(
        `missing required field '${field}' (expected finite number, got ${typeof value[field]})`,
      );
    }
  }
  if (!Array.isArray(value.files)) {
    throw new HealthResponseShapeError("missing required field 'files' (expected array)");
  }

  // Nested rollups — check the structural shape, not every leaf.
  const dedup = value.dedup as DedupStats | undefined;
  if (!isRecord(dedup)) {
    throw new HealthResponseShapeError("missing required field 'dedup'");
  }
  for (const field of ["rawLines", "distinctCalls", "duplicates"] as const) {
    if (!isFiniteNumber(dedup[field])) {
      throw new HealthResponseShapeError(
        `dedup.${field} must be a finite number (got ${typeof dedup[field]})`,
      );
    }
  }

  const parseErrors = value.parseErrors as ParseErrorSummary | undefined;
  if (!isRecord(parseErrors)) {
    throw new HealthResponseShapeError("missing required field 'parseErrors'");
  }
  if (!isFiniteNumber(parseErrors.malformedLines)) {
    throw new HealthResponseShapeError(
      `parseErrors.malformedLines must be a finite number (got ${typeof parseErrors.malformedLines})`,
    );
  }
  if (!Array.isArray(parseErrors.byFile)) {
    throw new HealthResponseShapeError("parseErrors.byFile must be an array");
  }

  const scan = value.scan as ScanCoverage | undefined;
  if (!isRecord(scan)) {
    throw new HealthResponseShapeError("missing required field 'scan'");
  }
  if (!Array.isArray(scan.roots)) {
    throw new HealthResponseShapeError("scan.roots must be an array");
  }
  for (const field of [
    "transcriptsFound",
    "transcriptsParsed",
    "transcriptsFailed",
    "sessionsWithSidecars",
  ] as const) {
    if (!isFiniteNumber(scan[field])) {
      throw new HealthResponseShapeError(
        `scan.${field} must be a finite number (got ${typeof scan[field]})`,
      );
    }
  }

  const pricingCoverage = value.pricingCoverage as PricingCoverage | undefined;
  if (!isRecord(pricingCoverage)) {
    throw new HealthResponseShapeError("missing required field 'pricingCoverage'");
  }
  for (const field of ["modelsSeen", "unpricedModels"] as const) {
    if (!Array.isArray(pricingCoverage[field])) {
      throw new HealthResponseShapeError(
        `pricingCoverage.${field} must be an array (got ${typeof pricingCoverage[field]})`,
      );
    }
  }

  const sidecarCoverage = value.sidecarCoverage as SidecarCoverage | undefined;
  if (!isRecord(sidecarCoverage)) {
    throw new HealthResponseShapeError("missing required field 'sidecarCoverage'");
  }
  for (const field of ["total", "withCost", "withBoundaries"] as const) {
    if (!isFiniteNumber(sidecarCoverage[field])) {
      throw new HealthResponseShapeError(
        `sidecarCoverage.${field} must be a finite number (got ${typeof sidecarCoverage[field]})`,
      );
    }
  }

  const reconciliation = value.reconciliation as ReconciliationRollup | undefined;
  if (!isRecord(reconciliation)) {
    throw new HealthResponseShapeError("missing required field 'reconciliation'");
  }
  for (const field of [
    "sessionsWithObserved",
    "sessionsWithComputedOnly",
    "costComputed",
    "costObserved",
  ] as const) {
    if (!isFiniteNumber(reconciliation[field])) {
      throw new HealthResponseShapeError(
        `reconciliation.${field} must be a finite number (got ${typeof reconciliation[field]})`,
      );
    }
  }

  const captureGaps = value.captureGaps as CaptureGaps | undefined;
  if (!isRecord(captureGaps)) {
    throw new HealthResponseShapeError("missing required field 'captureGaps'");
  }
  if (!isFiniteNumber(captureGaps.sessionsWithoutObserved)) {
    throw new HealthResponseShapeError(
      `captureGaps.sessionsWithoutObserved must be a finite number (got ${typeof captureGaps.sessionsWithoutObserved})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

/**
 * The one caller of `GET /api/health` (#P4-14). Returns the full
 * `HealthSnapshot` the Data Health page consumes — every fleet-level
 * stat is already rolled up server-side, so this wrapper is a pure
 * GET. Throws on non-2xx (typed `HealthApiError`) and on a 2xx whose
 * body fails the response-shape guard (typed `HealthResponseShapeError`,
 * review TS-3) so TanStack Query surfaces both via `isError` / `error`.
 * Accepts the `AbortSignal` TanStack Query passes to every `queryFn`
 * so a stale in-flight request is cancelled instead of finishing unread.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthSnapshot> {
  const response = await fetch("/api/health", {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
      cause?: unknown;
    } | null;
    const validation = body && typeof body.error === "string" ? body.error : null;
    const cause = body && typeof body.cause === "string" ? body.cause : null;
    const detail = [validation, cause].filter((s): s is string => s !== null).join(": ");
    throw new HealthApiError(
      response.status,
      validation,
      `GET /api/health failed (${response.status}): ${detail || response.statusText}`,
    );
  }
  const body: unknown = await response.json();
  assertHealthSnapshot(body);
  return body;
}
