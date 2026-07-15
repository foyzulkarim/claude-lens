import type { MetricsQuery, Series } from "../../../shared/metrics-contract.js";

// The one caller of POST /api/metrics (server/routes/metrics.ts). Throws on
// non-2xx so TanStack Query surfaces it via isError/error. Accepts the
// AbortSignal TanStack Query passes to every queryFn so a stale in-flight
// request (superseded by a rapid control-toggle changing the query key) is
// cancelled instead of finishing unread.
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
