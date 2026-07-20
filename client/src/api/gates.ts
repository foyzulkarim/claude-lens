import type { GateReport } from "../../../shared/gates-contract.js";

/**
 * Gates engine errors (#P4-11, ARCH-p4-12 §Cross-Cutting). The route
 * surfaces 404 (`{error:"session not found"}`) and 500 (`{error, cause,
 * sessionId}`); typed throws let TanStack Query distinguish them.
 */
export class GatesApiError extends Error {
  readonly status: number;
  readonly validation: string | null;

  constructor(status: number, validation: string | null, message: string) {
    super(message);
    this.name = "GatesApiError";
    this.status = status;
    this.validation = validation;
  }
}

/**
 * Structural-shape guard for `GateReport`. The route serializes the engine
 * output verbatim, so this is mostly defensive — at minimum it pins the
 * `gates` array length to seven (one per `GateId`) and the
 * `score`/`scoreLetter` shape so a future wire-refactor that drops or
 * mis-shapes a field crashes the Report Card render loudly instead of
 * silently rendering `undefined` cells.
 */
function isGateReport(value: unknown): value is GateReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === "string" &&
    Array.isArray(v.gates) &&
    v.gates.length === 7 &&
    typeof v.score === "number" &&
    Number.isFinite(v.score) &&
    (v.scoreLetter === "A" ||
      v.scoreLetter === "B" ||
      v.scoreLetter === "C" ||
      v.scoreLetter === "D" ||
      v.scoreLetter === "F") &&
    typeof v.evaluatedAt === "string" &&
    typeof v.thresholdsUsed === "object" &&
    v.thresholdsUsed !== null
  );
}

/**
 * GET /api/sessions/:id/gates — Report Card payload (#P4-11 / #P4-12).
 * The only caller is the Session Detail Report Card section, which
 * lazy-mounts via `useInView` so the E1/E2 filesystem check doesn't
 * block Session Detail's first paint.
 *
 * Mirrors `getSessionDetail`'s convention (AbortSignal passthrough,
 * typed throw on non-2xx). No shape-guard throw — the structural guard
 * is intentionally permissive enough not to false-positive on a future
 * additive contract change, but tight enough to catch a real
 * wire-shape drop.
 */
export async function getGateReport(id: string, signal?: AbortSignal): Promise<GateReport> {
  const url = `/api/sessions/${encodeURIComponent(id)}/gates`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const validation =
      body && typeof body === "object" && typeof body.error === "string"
        ? body.error
        : response.statusText;
    throw new GatesApiError(
      response.status,
      validation,
      `GET /api/sessions/${id}/gates failed (${response.status}): ${validation}`,
    );
  }

  const body: unknown = await response.json();
  if (!isGateReport(body)) {
    throw new GatesApiError(
      response.status,
      null,
      `GET /api/sessions/${id}/gates returned a response that does not match the GateReport shape`,
    );
  }
  return body;
}
