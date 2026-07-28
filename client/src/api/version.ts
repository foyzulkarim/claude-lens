import type { VersionSnapshot } from "../../../shared/version-contract.js";

/**
 * Thrown by `fetchVersion` on non-2xx responses. Mirrors
 * `CaptureAssetsApiError`/`HealthApiError` so callers can surface the
 * server's message verbatim rather than a generic Error string.
 */
export class VersionApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "VersionApiError";
    this.status = status;
  }
}

/**
 * The one caller of `GET /api/version`. Accepts the `AbortSignal` TanStack
 * Query passes to every `queryFn` so a stale in-flight request is cancelled
 * instead of finishing unread.
 */
export async function fetchVersion(signal?: AbortSignal): Promise<VersionSnapshot> {
  const response = await fetch("/api/version", { method: "GET", signal });
  if (!response.ok) {
    throw new VersionApiError(
      response.status,
      `GET /api/version failed (${response.status}): ${response.statusText}`,
    );
  }
  return (await response.json()) as VersionSnapshot;
}
