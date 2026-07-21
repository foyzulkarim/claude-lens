import type { HealthSnapshot } from "../../../shared/health-contract.js";

/**
 * The one caller of `GET /api/health` (#P4-14). Returns the full
 * `HealthSnapshot` the Data Health page consumes — every fleet-level
 * stat is already rolled up server-side, so this wrapper is a pure
 * GET. Throws on non-2xx so TanStack Query surfaces the error via
 * `isError` / `error`. Accepts the `AbortSignal` TanStack Query passes
 * to every `queryFn` so a stale in-flight request is cancelled
 * instead of finishing unread.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthSnapshot> {
  const response = await fetch("/api/health", {
    method: "GET",
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body && typeof body.error === "string" ? body.error : response.statusText;
    throw new Error(`GET /api/health failed (${response.status}): ${message}`);
  }
  return (await response.json()) as HealthSnapshot;
}
