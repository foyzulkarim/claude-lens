import type { CaptureAssets } from "../../../shared/capture-assets-contract.js";

/**
 * Thrown by `fetchCaptureAssets` on non-2xx responses. Mirrors
 * `HealthApiError` so the guide's error state can surface the server's
 * message verbatim rather than a generic Error string.
 */
export class CaptureAssetsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CaptureAssetsApiError";
    this.status = status;
  }
}

/**
 * The one caller of `GET /api/capture-assets`
 * (ARCH-producer-cost-capture-tier §API Contracts). Returns the absolute
 * on-disk location of the vendored `capture/` directory, or `null` when it
 * can't be resolved (S7) — `CostCaptureGuide.tsx` renders manual fallback
 * instructions in that case. Accepts the `AbortSignal` TanStack Query
 * passes to every `queryFn` so a stale in-flight request is cancelled
 * instead of finishing unread.
 */
export async function fetchCaptureAssets(signal?: AbortSignal): Promise<CaptureAssets> {
  const response = await fetch("/api/capture-assets", { method: "GET", signal });
  if (!response.ok) {
    throw new CaptureAssetsApiError(
      response.status,
      `GET /api/capture-assets failed (${response.status}): ${response.statusText}`,
    );
  }
  return (await response.json()) as CaptureAssets;
}
